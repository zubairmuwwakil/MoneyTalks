import { CardProduct, PurchaseContext, OwnerState, CardState, EarnRule, Earn, Valuations } from './models';
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

    const gross = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'declared');
    const grossFloor = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'floor');
    const grossAspirational = Scorer.valueCad(units, card.program.programId, ownerState.valuationsCad, state, 'aspirational');

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

  valueCad(units: number, program: string, valuations: Valuations, state: CardState, band: ValuationBand = 'declared'): number {
    const cents = (v: any) => {
      switch (band) {
        case 'declared': return v.centsPerPoint;
        case 'floor': return v.floorCentsPerPoint ?? v.centsPerPoint;
        case 'aspirational': return Math.max(v.aspirationalCentsPerPoint ?? v.centsPerPoint, v.centsPerPoint);
      }
    };

    switch (program) {
      case 'amexMembershipRewards': return (units * cents(valuations.amexMembershipRewards)) / 100;
      case 'marriottBonvoy': return (units * cents(valuations.marriottBonvoy)) / 100;
      case 'mbnaRewards': return (units * cents(valuations.mbnaRewards)) / 100;
      case 'ctMoney': {
        const v = valuations.ctMoney;
        return units * v.cadPerUnit * (v.usabilityFactorApplied ? v.optionalUsabilityFactor : 1);
      }
      case 'cro': {
        const factor = state.croHandling === 'autoSell' 
          ? valuations.cro.faceValueFactorIfAutoSold 
          : valuations.cro.defaultHeldRiskFactor;
        return units * factor;
      }
      case 'cashback': return units * valuations.cashBack.cadPerDollar;
      // An unrecognised loyalty program is worth NOTHING, matching Swift's
      // Scorer.swift `default: return 0.0`. Falling through to the cashback
      // rate instead valued unknown points as dollars 1:1, which made every
      // card in an unfamiliar program look like a top-tier cashback card and
      // win recommendations it should never win. Invisible until the
      // catalogue grew past the programs owner-state has valuations for.
      default: return 0;
    }
  }
};
