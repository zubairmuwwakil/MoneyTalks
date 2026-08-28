import {
  CardProduct, PurchaseContext, OwnerState, EarnRule, FxRule, CardState, Predicate, Earn,
  KNOWN_ENGINE_CAPABILITIES, SUPPORTED_ENGINE_CAPABILITIES, resolvedFlags,
} from './models';

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

  // Mirrors Swift's RuleMatcher.isLive = isScheduleLive && capabilityGap == nil.
  //
  // The twin checked only `scoredInV1` until 2026-08-24 and knew nothing of the
  // requires/outOfScope refactor, so it scored rules Swift skips. No fixture could
  // catch it while the twin also ignored ownedCardIds and scored the whole
  // catalogue — the two omissions cancelled out.
  isLive(rule: EarnRule, asOf: string): boolean {
    return RuleMatcher.isScheduleLive(rule, asOf) && RuleMatcher.capabilityGap(rule) === null;
  },

  /// Liveness that is NOT about capability — dates, `scoredInV1`, and the permanent
  /// `outOfScope` verdict. "Never" is not a gap awaiting a fix, so it is not reportable.
  isScheduleLive(rule: EarnRule, asOf: string): boolean {
    if (rule.outOfScope) return false;
    if (rule.scoredInV1 === false) return false;
    const fromOk = rule.effectiveFrom ? rule.effectiveFrom <= asOf : true;
    const toOk = rule.effectiveTo ? asOf <= rule.effectiveTo : true;
    return fromOk && toOk;
  },

  /// Capability names this rule needs and this build lacks, or null when fully supported.
  /// Unknown strings fail closed and are reported by name: an unrecognised capability is a
  /// data error, and assuming support would score a rule the engine cannot honour.
  capabilityGap(rule: EarnRule): string[] | null {
    if (!rule.requires) return null;
    const missing = rule.requires.filter(
      (name) => !KNOWN_ENGINE_CAPABILITIES.has(name) || !SUPPORTED_ENGINE_CAPABILITIES.has(name),
    );
    return missing.length === 0 ? null : missing;
  },

  conditionsResolveTrue(conditions: string[] | undefined, state: CardState): boolean {
    if (!conditions) return true;
    const flags = resolvedFlags(state);
    return conditions.every(condition => {
      switch (condition) {
        case 'tangerineCategorySelected':
          return state.selectedCategories !== undefined;
        default:
          return flags[condition] ?? false;
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
        case 'ownerSelectedCategory':
          // Generalized 2026-08-26 for US selectable-category cards — both names accepted so
          // no existing catalogue rule needs rewriting.
          return RuleMatcher.matchesOwnerSelection(purchase, state);
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
   * Faithful port of Swift's RuleMatcher.matchesOwnerSelection (renamed 2026-08-26 from
   * matchesTangerineSelection, generalized for non-Tangerine selectable-category cards — the
   * mechanism itself was never Tangerine-specific). The twin previously did a flat
   * `selectedCategories.includes(purchase.category)`, which missed three of Swift's four match
   * paths — most importantly the `recurring` selection, so a recurring purchase in an unselected
   * category (an insurance premium, say) never matched and Tangerine silently dropped out of the
   * ranking.
   */
  matchesOwnerSelection(purchase: PurchaseContext, state: CardState): boolean {
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
      case 'points': return earn.pointsPerUnit;
      case 'cashback': return earn.rate * 100;
      case 'centsPerLitre': return -1;
    }
  }
};
