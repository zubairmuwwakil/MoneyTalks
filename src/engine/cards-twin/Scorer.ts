import { inferValuationModel, PointValuation, CardProduct, PurchaseContext, OwnerState, CardState, Earn, Valuations } from './models';
import { RuleMatcher } from './RuleMatcher';
import { CapMath } from './CapMath';
import { toReporting } from './reportingCurrency';

export type Warning =
  | 'drawerCard'
  | 'unresolvedOwnerState'
  | 'networkNotAccepted'
  /// Distinct from `networkNotAccepted` on purpose: "this card only works at Kohl's" and
  /// "Visa isn't accepted here" are different facts about a decline, and collapsing them would
  /// tell an owner to go find a Visa when the card is simply the wrong store's.
  | 'merchantNotAccepted'
  | 'capNearlyExhausted'
  | 'negativeNetValue'
  | 'fxAllowanceAssumed'
  | 'hypotheticalSelection';

export interface CandidateScore {
  cardId: string;
  appliedRuleId: string | null;
  rewardUnits: number;
  grossRewardCad: number;
  fxCostCad: number;
  netValueCad: number;
  floorNetValueCad: number;
  aspirationalNetValueCad: number;
  warnings: Warning[];
  excluded: boolean;
  exclusionReason: string | null;
}

export type ValuationBand = 'declared' | 'floor' | 'aspirational';

export const Scorer = {
  fallbackCadToUsd: 0.73,

  score(card: CardProduct, purchase: PurchaseContext, ownerState: OwnerState, asOf: string): CandidateScore {
    const excludedScore = (warning: Warning, reason: string): CandidateScore => ({
      cardId: card.cardId,
      appliedRuleId: null,
      rewardUnits: 0,
      grossRewardCad: 0,
      fxCostCad: 0,
      netValueCad: 0,
      floorNetValueCad: 0,
      aspirationalNetValueCad: 0,
      warnings: [warning],
      excluded: true,
      exclusionReason: reason,
    });

    // A draft catalogue record has not cleared D3's issuer-confirmed sourcing bar. Excluded
    // outright, never merely scored with a caveat — reuses `unresolvedOwnerState` rather than
    // adding a new Warning variant, consistent with how this twin already collapses several
    // distinct Swift/Kotlin exclusion reasons into that one case.
    if ((card.status ?? 'published') !== 'published') {
      return excludedScore('unresolvedOwnerState', 'draft catalogue record, not yet issuer-verified');
    }

    // Two acceptance mechanisms, not one. An open-loop card is accepted because the merchant
    // takes its network; a closed-loop card is accepted because the merchant IS its issuer's
    // store. Forcing the second through a network check is what made private-label cards
    // unrepresentable without guessing `network` — and the guess is not harmless: a Kohl's card
    // recorded as `visa` is recommended at a gas station and declined at the till.
    //
    // Absent `acceptance` coalesces to 'openLoop', so every pre-2.7 card takes the identical
    // path it always did. Mirrors Swift's Scorer.score.
    if ((card.acceptance?.scope ?? 'openLoop') === 'openLoop') {
      const acceptedNetworks = purchase.acceptedNetworks ?? ['amex', 'visa', 'mastercard', 'discover'];
      if (!acceptedNetworks.includes(card.network)) {
        return excludedScore('networkNotAccepted', `${card.network} not accepted`);
      }
    } else {
      // Unresolved `merchantBrand` excludes rather than admits. These cards are only ever as
      // good as brand resolution, and silence beats recommending a card that gets declined.
      const merchants = card.acceptance?.merchants ?? [];
      if (!purchase.merchantBrand || !merchants.includes(purchase.merchantBrand)) {
        return excludedScore('merchantNotAccepted', `accepted only at ${merchants.join(', ')}`);
      }
    }

    // A card in a program nobody has valued cannot be scored — mirrors Swift's guard in
    // Scorer.score. It must EXCLUDE rather than score zero: zero is a real answer meaning
    // "valued, and this earn is worth nothing", and treating "unvalued" as zero is what made
    // unvalued programs quietly rank last instead of declaring themselves unscorable.
    if (
      Scorer.valueCad(0, card.program.programId, ownerState.valuationsCad, ownerState.cardStates[card.cardId] || {}) === null
    ) {
      return excludedScore('unresolvedOwnerState', `no valuation for program ${card.program.programId}`);
    }

    const resolution = RuleMatcher.resolve(card, purchase, ownerState, asOf);
    if (resolution.type === 'cardExcluded') {
      return excludedScore('unresolvedOwnerState', resolution.reason);
    }
    const rule = resolution.rule;

    const warnings: Warning[] = [];
    const state = ownerState.cardStates[card.cardId] || {};

    // The purchase amount expressed in THIS card's own billingCurrency — 'points per currency
    // unit' means per unit of that currency, not per CAD unconditionally. For a CAD-billing
    // card (every card in this catalogue until the multi-market import) this is exactly
    // `purchase.amountCad`, unchanged.
    const nativeAmount = card.billingCurrency === 'USD'
      ? (purchase.usdEquivalent ?? purchase.amountCad * Scorer.fallbackCadToUsd)
      : purchase.amountCad;

    let inCapAmount = nativeAmount;
    let overCapAmount = 0.0;

    if (rule.capId) {
      const cap = card.caps.find(c => c.capId === rule.capId);
      if (cap) {
        const usage = state.capProgress?.[cap.capId] ?? 0;
        const measureAmount = cap.measure === 'spendUsdEquivalent'
          ? (purchase.usdEquivalent ?? purchase.amountCad * Scorer.fallbackCadToUsd)
          : nativeAmount;
        const split = CapMath.split(measureAmount, cap.limit, usage);
        const inFraction = measureAmount > 0 ? split.inCap / measureAmount : 1;
        inCapAmount = nativeAmount * inFraction;
        overCapAmount = nativeAmount - inCapAmount;
        if (usage >= cap.limit * 0.9) {
          warnings.push('capNearlyExhausted');
        }
      }
    }

    const postCapEarn = rule.capId
      ? card.caps.find(c => c.capId === rule.capId)?.postCapEarn
      : undefined;

    // Cashback earns real money in the card's own billing currency — unlike points, which are a
    // currency-agnostic token whose count does not depend on what currency was spent, a cashback
    // "unit" IS a dollar amount and must be converted to the CAD reporting currency before
    // valueCad's cashback case (units * cadPerDollar) treats it as one. Converted per portion, not
    // once at the end, in case a straddling purchase's post-cap earn is ever a different type
    // than its in-cap earn.
    const unitsInReportingCurrency = (earn: Earn, amount: number): number => {
      const raw = Scorer.earnUnits(earn, amount);
      return earn.type === 'cashback' ? toReporting({ amount: raw, currency: card.billingCurrency }) : raw;
    };

    const units = unitsInReportingCurrency(rule.earn, inCapAmount) + unitsInReportingCurrency(postCapEarn ?? rule.earn, overCapAmount);

    // Asserted non-null, not `?? 0`: the guard above proves a valuation exists, and `?? 0` would
    // quietly reinstate the zero-scoring bug if a refactor ever moved that guard.
    const gross = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'declared')!;
    const grossFloor = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'floor')!;
    const grossAspirational = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'aspirational')!;

    let fxCost = 0.0;
    // Compares against THIS card's billing currency, not a hardcoded "CAD".
    if (purchase.currency !== card.billingCurrency) {
      const fx = RuleMatcher.activeFxRule(card, asOf);
      if (fx) {
        if (fx.freeAllowanceCadPerCalendarMonth !== undefined && fx.freeAllowanceCadPerCalendarMonth !== null) {
          warnings.push('fxAllowanceAssumed');
        } else {
          // The spread is charged in the card's own billing currency, then converted to the CAD
          // reporting figure. For a CAD-billing card this is the identity.
          fxCost = toReporting({ amount: nativeAmount * fx.rate, currency: card.billingCurrency });
        }
      }
    }

    const net = gross - fxCost;
    if (net < 0) warnings.push('negativeNetValue');
    if (ownerState.carry.drawerCards.includes(card.cardId)) warnings.push('drawerCard');
    if (rule.ruleId === 'tangerine-selected-2pct' && state.treatAsAllSelected === true) {
      warnings.push('hypotheticalSelection');
    }

    return {
      cardId: card.cardId,
      appliedRuleId: rule.ruleId,
      rewardUnits: units,
      grossRewardCad: gross,
      fxCostCad: fxCost,
      netValueCad: net,
      floorNetValueCad: grossFloor - fxCost,
      aspirationalNetValueCad: grossAspirational - fxCost,
      warnings,
      excluded: false,
      exclusionReason: null,
    };
  },

  /// `amount` is already expressed in the card's own `billingCurrency` — the caller converts.
  earnUnits(earn: Earn, amount: number): number {
    switch (earn.type) {
      case 'points': return amount * earn.pointsPerUnit;
      case 'cashback': return amount * earn.rate;
      case 'centsPerLitre': return 0;
    }
  },

  /// Null means the program has NO valuation — the card cannot be scored. Zero means the program
  /// IS valued and this earn is worth nothing. Conflating them is the bug that made 11 of the
  /// corpus's 16 programs rank last here while Swift ranked them correctly, so the two stay
  /// distinct exactly as they do in Swift's Scorer.valueCad.
  ///
  /// Dispatches on the valuation's `model`, never on the program's name: a name-keyed switch can
  /// only ever value the programs it lists, which is the coupling this removes.
  valueCad(
    units: number,
    program: string,
    valuations: Valuations,
    state: CardState,
    band: ValuationBand = 'declared',
  ): number | null {
    const cents = (v: PointValuation) => {
      switch (band) {
        case 'declared': return v.centsPerPoint;
        case 'floor': return v.floorCentsPerPoint ?? v.centsPerPoint;
        case 'aspirational': return Math.max(v.aspirationalCentsPerPoint ?? v.centsPerPoint, v.centsPerPoint);
      }
    };

    const valuation = inferValuationModel(
      (valuations as Record<string, unknown>)[program] as Record<string, unknown>,
    );
    if (!valuation) return null;

    switch (valuation.model) {
      case 'points':
        return (units * cents(valuation)) / 100;
      case 'ctMoney':
        return units * valuation.cadPerUnit * (valuation.usabilityFactorApplied ? valuation.optionalUsabilityFactor : 1);
      case 'merchantCredit':
        // Identical arithmetic to ctMoney, and a separate arm on purpose — see
        // MerchantCreditValuation's note in models.ts. `merchantScope` is disclosure; nothing
        // here dispatches on it.
        return units * valuation.cadPerUnit * (valuation.usabilityFactorApplied ? valuation.optionalUsabilityFactor : 1);
      case 'cro':
        return units * (state.croHandling === 'autoSell'
          ? valuation.faceValueFactorIfAutoSold
          : valuation.defaultHeldRiskFactor);
      case 'cashback':
        return units * valuation.cadPerDollar;
      case 'noRewards':
        // 0, never null. null means "unvalued" and excludes the card; this card IS valued, and
        // what it earns is nothing. Collapsing the two hides a real product from a comparison it
        // belongs in.
        return 0;
    }
  }
};
