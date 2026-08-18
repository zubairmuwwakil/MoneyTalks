import { CardProduct, PurchaseContext, OwnerState, EarnRule, FxRule, CardState, Predicate, Earn } from './models';

export type RuleResolution = 
  | { type: 'applied'; rule: EarnRule }
  | { type: 'cardExcluded'; reason: string };

const categoryParents: Record<string, string[]> = {
  'marriottDirect': ['lodging', 'travel']
};

export const RuleMatcher = {
  resolve(card: CardProduct, purchase: PurchaseContext, ownerState: OwnerState, asOf: string): RuleResolution {
    const state = ownerState.cardStates[card.cardId] || {};
    const candidates = card.earnRules.filter(rule => 
      RuleMatcher.isLive(rule, asOf) &&
      RuleMatcher.conditionsResolveTrue(rule.ownerConditions, state) &&
      RuleMatcher.matches(rule.predicate, purchase, state)
    );

    if (candidates.length === 0) {
      return { type: 'cardExcluded', reason: 'no scorable earn rule (unresolved or inactive owner state)' };
    }

    // max by rawEarn
    let best = candidates[0];
    let bestEarn = RuleMatcher.rawEarn(best.earn);
    for (let i = 1; i < candidates.length; i++) {
      const earn = RuleMatcher.rawEarn(candidates[i].earn);
      if (earn > bestEarn) {
        best = candidates[i];
        bestEarn = earn;
      }
    }

    return { type: 'applied', rule: best };
  },

  activeFxRule(card: CardProduct, asOf: string): FxRule | undefined {
    return card.fxRules.find(rule => 
      (rule.effectiveFrom ? rule.effectiveFrom <= asOf : true) &&
      (rule.effectiveTo ? asOf <= rule.effectiveTo : true)
    );
  },

  isLive(rule: EarnRule, asOf: string): boolean {
    if (rule.scoredInV1 === false) return false;
    const fromOk = rule.effectiveFrom ? rule.effectiveFrom <= asOf : true;
    const toOk = rule.effectiveTo ? asOf <= rule.effectiveTo : true;
    return fromOk && toOk;
  },

  conditionsResolveTrue(conditions: string[] | undefined, state: CardState): boolean {
    if (!conditions) return true;
    return conditions.every(condition => {
      // simulate 'unsetFields' logic for unresolved owner states
      if (state.unsetFields && state.unsetFields.includes(condition)) {
        return false;
      }

      switch (condition) {
        case 'rogersEligibleServiceLinked':
          return state.rogersEligibleServiceLinked === true;
        case 'cryptoLevelUpProActive':
          return state.cryptoLevelUpProActive === true;
        case 'tangerineCategorySelected':
          return state.selectedCategories !== undefined;
        default:
          return false;
      }
    });
  },

  matches(p: Predicate, purchase: PurchaseContext, state: CardState): boolean {
    if (p.country && p.country !== (purchase.country || 'CA')) return false;
    if (p.currency && p.currency !== purchase.currency) return false;
    if (p.channels && !p.channels.includes(purchase.channel || 'cardPresent')) return false;
    if (p.merchantExclude && purchase.merchantBrand && p.merchantExclude.includes(purchase.merchantBrand)) return false;
    if (p.merchantInclude) {
      if (!purchase.merchantBrand || !p.merchantInclude.includes(purchase.merchantBrand)) return false;
    }
    if (p.mccExclude && purchase.mcc && p.mccExclude.includes(purchase.mcc)) return false;

    if (!p.categories) return true; // no category clause = base rule

    return p.categories.some(category => {
      switch (category) {
        case 'recurring':
          return purchase.recurringIndicator === true;
        case 'ownerSelectedTangerineCategory':
          return state.selectedCategories?.includes(purchase.category) ?? false;
        default:
          const selfOrParents = [purchase.category, ...(categoryParents[purchase.category] || [])];
          if (!selfOrParents.includes(category)) return false;
          if (p.mccInclude && purchase.mcc) {
            return p.mccInclude.includes(purchase.mcc); // a known MCC must qualify; unknown falls back
          }
          return true;
      }
    });
  },

  rawEarn(earn: Earn): number {
    switch (earn.type) {
      case 'points': return earn.pointsPerCad;
      case 'cashback': return earn.rate * 100;
      case 'centsPerLitre': return -1;
    }
  }
};
