import { inferValuationModel, ProgramValuation, PointValuation, CardProduct, PurchaseContext, OwnerState, CardState, EarnRule, Earn, Valuations } from './models';
import { RuleMatcher } from './RuleMatcher';
import { CapMath } from './CapMath';

export type Warning =
  | 'drawerCard'
  | 'unresolvedOwnerState'
  | 'networkNotAccepted'
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

    const acceptedNetworks = purchase.acceptedNetworks ?? ['amex', 'visa', 'mastercard'];
    if (!acceptedNetworks.includes(card.network)) {
      return excludedScore('networkNotAccepted', `${card.network} not accepted`);
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

    let inCapCad = purchase.amountCad;
    let overCapCad = 0.0;

    if (rule.capId) {
      const cap = card.caps.find(c => c.capId === rule.capId);
      if (cap) {
        const usage = state.capProgress?.[cap.capId] ?? 0;
        const measureAmount = cap.measure === 'spendUsdEquivalent'
          ? (purchase.usdEquivalent ?? purchase.amountCad * Scorer.fallbackCadToUsd)
          : purchase.amountCad;
        const split = CapMath.split(measureAmount, cap.limit, usage);
        const inFraction = measureAmount > 0 ? split.inCap / measureAmount : 1;
        inCapCad = purchase.amountCad * inFraction;
        overCapCad = purchase.amountCad - inCapCad;
        if (usage >= cap.limit * 0.9) {
          warnings.push('capNearlyExhausted');
        }
      }
    }

    const postCapEarn = rule.capId 
      ? card.caps.find(c => c.capId === rule.capId)?.postCapEarn 
      : undefined;

    const units = Scorer.earnUnits(rule.earn, inCapCad) + Scorer.earnUnits(postCapEarn ?? rule.earn, overCapCad);

    // Asserted non-null, not `?? 0`: the guard above proves a valuation exists, and `?? 0` would
    // quietly reinstate the zero-scoring bug if a refactor ever moved that guard.
    const gross = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'declared')!;
    const grossFloor = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'floor')!;
    const grossAspirational = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'aspirational')!;

    let fxCost = 0.0;
    const currency = purchase.currency;
    if (currency !== 'CAD') {
      const fx = RuleMatcher.activeFxRule(card, asOf);
      if (fx) {
        if (fx.freeAllowanceCadPerCalendarMonth !== undefined && fx.freeAllowanceCadPerCalendarMonth !== null) {
          warnings.push('fxAllowanceAssumed');
        } else {
          fxCost = purchase.amountCad * fx.rate;
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

  earnUnits(earn: Earn, amountCad: number): number {
    switch (earn.type) {
      case 'points': return amountCad * earn.pointsPerCad;
      case 'cashback': return amountCad * earn.rate;
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
      case 'cro':
        return units * (state.croHandling === 'autoSell'
          ? valuation.faceValueFactorIfAutoSold
          : valuation.defaultHeldRiskFactor);
      case 'cashback':
        return units * valuation.cadPerDollar;
    }
  }
};
