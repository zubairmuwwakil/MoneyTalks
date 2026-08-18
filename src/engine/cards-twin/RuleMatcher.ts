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
          return RuleMatcher.matchesTangerineSelection(purchase, state);
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

  /**
   * Faithful port of Swift's RuleMatcher.matchesTangerineSelection. The twin
   * previously did a flat `selectedCategories.includes(purchase.category)`,
   * which missed three of Swift's four match paths — most importantly the
   * `recurring` selection, so a recurring purchase in an unselected category
   * (an insurance premium, say) never matched and Tangerine silently dropped
   * out of the ranking.
   */
  matchesTangerineSelection(purchase: PurchaseContext, state: CardState): boolean {
    if (state.selectedCategories === undefined) return false;
    const selected = new Set(state.selectedCategories);
    const purchaseCategories = [purchase.category, ...(categoryParents[purchase.category] || [])];

    if (purchaseCategories.some(category => selected.has(category))) return true;
    if (purchase.recurringIndicator && selected.has('recurring')) return true;
    if ((purchase.currency ?? 'CAD').toUpperCase() !== 'CAD' && selected.has('foreignCurrency')) return true;

    // Backward compatibility for owner-state files that used Tangerine's
    // label-shaped id before the setup screen adopted the engine's canonical
    // `lodging` category.
    return purchaseCategories.includes('lodging') && selected.has('hotelMotel');
  },

  rawEarn(earn: Earn): number {
    switch (earn.type) {
      case 'points': return earn.pointsPerCad;
      case 'cashback': return earn.rate * 100;
      case 'centsPerLitre': return -1;
    }
  }
};
