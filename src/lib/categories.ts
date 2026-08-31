import purchaseCategoryContractJSON from "../../contracts/purchase-categories.json";

/**
 * The ONE spend-category vocabulary.
 *
 * Every id below is in PickMe's canonical purchase/merchant vocabulary. The
 * scorable subset is named by card-catalogue predicates and compared exactly
 * by `RuleMatcher.matches`; the rest remain truthful purchase classifications
 * that earn each card's base rate.
 *
 * This file used to carry its own vocabulary — `groceries`, `gas`, `bills`,
 * `drugstore`, `hotel` — against the catalogue's `grocery`, `gasStation`,
 * `householdUtilities`, `drugStore`, `lodging`. Clicking "Groceries" wrote
 * `"groceries"`, `applyCapAccrual` passed it to the engine, the engine looked
 * for `"grocery"`, and the purchase quietly scored at base earn with no cap
 * accrual. Five of fifteen categories failed that way, and seven scorable
 * catalogue categories (foodDelivery, digitalMedia, memberships, ctFamily,
 * carRental, evCharging, marriottDirect) could not be selected at all.
 *
 * Labels and icons are presentation and live here. Tokens are contract and
 * come from the catalogue. `categories.catalogue.test.ts` asserts every
 * scorable catalogue category is offered — the failure mode it exists to
 * prevent is silent: a category the app can infer but the owner cannot pick
 * pushes real spend into whichever neighbouring option happened to be on
 * screen.
 */

export interface CategoryDefinition {
  id: string;
  label: string;
  parentID?: string;
  merchantGroupID?: string;
  icon: string;
  badgeClass: string;
  /**
   * False when no catalogue earn rule names this token. Such a category is
   * still a true fact about a purchase and still worth recording — it just
   * scores at each card's base rate. Mirrors PickMe's
   * `unscoredPredictableCategories` (Store/Sources/CardCopilotStore/CategoryMapper.swift).
   */
  scorable: boolean;
}

interface ContractCategory {
  id: string;
  displayName: string;
  parentID?: string;
  merchantGroupID?: string;
  aliases: string[];
}

interface PurchaseCategoryContract {
  taxonomyVersion: string;
  categories: ContractCategory[];
  ruleSideCategories: ContractCategory[];
}

type CategoryPresentation = Pick<CategoryDefinition, "icon" | "badgeClass" | "scorable">;

/** Product-specific visual metadata. IDs, labels, and aliases come from the vendored contract. */
const CATEGORY_PRESENTATION = {
  dining: { icon: "🍔", scorable: true, badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  foodDelivery: { icon: "🛵", scorable: true, badgeClass: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20" },
  grocery: { icon: "🛒", scorable: true, badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
  gasStation: { icon: "⛽", scorable: true, badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20" },
  evCharging: { icon: "🔌", scorable: true, badgeClass: "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/20" },
  transit: { icon: "🚇", scorable: true, badgeClass: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20" },
  travel: { icon: "✈️", scorable: true, badgeClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20" },
  lodging: { icon: "🏨", scorable: true, badgeClass: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20" },
  marriottDirect: { icon: "🛎️", scorable: true, badgeClass: "bg-indigo-600/10 text-indigo-800 dark:text-indigo-200 border-indigo-600/20" },
  carRental: { icon: "🚗", scorable: true, badgeClass: "bg-stone-500/10 text-stone-700 dark:text-stone-300 border-stone-500/20" },
  drugStore: { icon: "💊", scorable: true, badgeClass: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20" },
  householdUtilities: { icon: "⚡", scorable: true, badgeClass: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20" },
  streaming: { icon: "🍿", scorable: true, badgeClass: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20" },
  digitalMedia: { icon: "💾", scorable: true, badgeClass: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/20" },
  entertainment: { icon: "🎬", scorable: true, badgeClass: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20" },
  memberships: { icon: "🎟️", scorable: true, badgeClass: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20" },
  fitness: { icon: "🏋️", scorable: false, badgeClass: "bg-teal-600/10 text-teal-800 dark:text-teal-200 border-teal-600/20" },
  insurance: { icon: "🛡️", scorable: false, badgeClass: "bg-blue-600/10 text-blue-800 dark:text-blue-200 border-blue-600/20" },
  homeImprovement: { icon: "🔨", scorable: false, badgeClass: "bg-amber-700/10 text-amber-800 dark:text-amber-200 border-amber-700/20" },
  furniture: { icon: "🛋️", scorable: false, badgeClass: "bg-orange-700/10 text-orange-800 dark:text-orange-200 border-orange-700/20" },
  eGames: { icon: "🎮", scorable: false, badgeClass: "bg-violet-600/10 text-violet-800 dark:text-violet-200 border-violet-600/20" },
  ctFamily: { icon: "🔧", scorable: true, badgeClass: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20" },
  retailShopping: { icon: "🛍️", scorable: true, badgeClass: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20" },
  wholesaleClub: { icon: "📦", scorable: false, badgeClass: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20" },
  other: { icon: "🏷️", scorable: false, badgeClass: "bg-muted text-muted-foreground border-border/60" },
} as const satisfies Readonly<Record<string, CategoryPresentation>>;

export type PurchaseCategoryId = keyof typeof CATEGORY_PRESENTATION;

const purchaseCategoryContract = purchaseCategoryContractJSON as PurchaseCategoryContract;
export const PURCHASE_CATEGORY_TAXONOMY_VERSION = purchaseCategoryContract.taxonomyVersion;
const contractCategoryIDs = new Set(purchaseCategoryContract.categories.map(({ id }) => id));
const presentationCategoryIDs = Object.keys(CATEGORY_PRESENTATION);

if (contractCategoryIDs.size !== purchaseCategoryContract.categories.length ||
    presentationCategoryIDs.some((id) => !contractCategoryIDs.has(id)) ||
    purchaseCategoryContract.categories.some(({ id }) => !(id in CATEGORY_PRESENTATION))) {
  throw new Error("purchase-categories.json and MoneyTalks category presentation metadata disagree");
}

export const CATEGORIES: readonly CategoryDefinition[] = purchaseCategoryContract.categories.map(
  ({ id, displayName, parentID, merchantGroupID }) => ({
    id,
    label: displayName,
    parentID,
    merchantGroupID,
    ...CATEGORY_PRESENTATION[id as PurchaseCategoryId],
  }),
);

const CATEGORY_MAP = new Map<string, CategoryDefinition>(CATEGORIES.map((cat) => [cat.id, cat]));

/** Metadata-only hierarchy helpers; card-rule matching always uses the canonical leaf id. */
export function categoryParentIDs(category: string): string[] {
  const parents: string[] = [];
  const seen = new Set<string>();
  let current = normalizePurchaseCategoryId(category);
  while (current) {
    const parent = CATEGORY_MAP.get(current)?.parentID;
    if (!parent || seen.has(parent)) break;
    parents.push(parent);
    seen.add(parent);
    current = parent;
  }
  return parents;
}

export function merchantGroupID(category: string): string | null {
  return CATEGORY_MAP.get(normalizePurchaseCategoryId(category))?.merchantGroupID ?? null;
}

/**
 * Catalogue tokens that are real stored values but must NOT appear in a
 * picker. `recurring` matches on `PurchaseContext.recurringIndicator` alone
 * (RuleMatcher's `'recurring'` switch case), and
 * `ownerSelectedCategory` (and its legacy Tangerine-specific spelling) stands
 * in for whatever the owner picked — no purchase is ever "in" any of these,
 * so offering them invites a meaningless answer.
 */
export const RULE_SIDE_CATEGORY_TOKENS: ReadonlySet<string> = new Set(
  purchaseCategoryContract.ruleSideCategories.map(({ id }) => id),
);

/**
 * Pre-convergence ids, plus the loose synonyms that reached the DB through
 * `/settings/merchants` and old query strings. Kept forever, not until the
 * migration runs: a bookmarked `/purchases?category=groceries` must keep
 * working, and so must any row an import writes in the old vocabulary.
 */
export const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(purchaseCategoryContract.categories.flatMap(({ id, aliases }) =>
    aliases.map((alias) => [alias.toLocaleLowerCase("en-CA"), id]))),
);

function compactKey(raw: string): string {
  return raw.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleLowerCase("en-CA");
}

const CATEGORY_ID_BY_COMPACT_KEY: ReadonlyMap<string, string> = (() => {
  const result = new Map<string, string>();
  for (const definition of [
    ...purchaseCategoryContract.categories,
    ...purchaseCategoryContract.ruleSideCategories,
  ]) {
    for (const raw of [definition.id, ...definition.aliases]) {
      const key = compactKey(raw);
      const existing = result.get(key);
      if (existing && existing !== definition.id) {
        throw new Error(`Ambiguous purchase category alias '${raw}': ${existing}, ${definition.id}`);
      }
      result.set(key, definition.id);
    }
  }
  return result;
})();

/**
 * Resolves any stored value, query param, or legacy alias to a catalogue
 * token — or `null` when it resolves to nothing recognizable.
 *
 * Returning `null` rather than the cleaned input is deliberate. The previous
 * version fell through to `return cleaned`, so a typo entered the system as a
 * category and then read back out of it looking legitimate; nothing ever
 * scored it and nothing ever flagged it.
 */
export function normalizeCategoryId(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return CATEGORY_ID_BY_COMPACT_KEY.get(compactKey(trimmed)) ?? null;
}

/**
 * Resolves input to a category that may be stored on a purchase or merchant.
 * Rule-side predicate tokens deliberately fail this narrower check: they are
 * valid catalogue vocabulary, but they do not describe what a purchase was.
 */
export function normalizePurchaseCategoryId(
  raw?: string | null,
): PurchaseCategoryId | null {
  const normalized = normalizeCategoryId(raw);
  return normalized && CATEGORY_MAP.has(normalized)
    ? (normalized as PurchaseCategoryId)
    : null;
}

/**
 * Every stored value a filter on `category` must match to be honest.
 *
 * A `/purchases?category=grocery` filter has to find rows written before the
 * convergence (`groceries`) as well as after it. Rather than the hand-kept
 * synonym bag this replaces, the set is derived by inverting the alias table,
 * so a legacy id added above is covered here for free.
 */
export function categoryQueryTokens(raw?: string | null): string[] {
  const canonical = normalizeCategoryId(raw);
  if (!canonical) return raw ? [raw.trim()] : [];
  const tokens = new Set<string>([canonical]);
  if (raw) tokens.add(raw.trim());
  for (const [legacy, target] of Object.entries(LEGACY_CATEGORY_ALIASES)) {
    if (target === canonical) tokens.add(legacy);
  }
  return [...tokens];
}

const UNCATEGORIZED: CategoryDefinition = Object.freeze({
  id: "uncategorized",
  label: "Uncategorized",
  icon: "❓",
  badgeClass: "bg-muted/60 text-muted-foreground border-border/40",
  scorable: false,
});

/** Metadata (label, icon, styling) for a stored category value. */
export function getCategoryMeta(category?: string | null): CategoryDefinition {
  if (!category || category === "uncategorized") return UNCATEGORIZED;

  const normalized = normalizeCategoryId(category);
  if (normalized && CATEGORY_MAP.has(normalized)) return CATEGORY_MAP.get(normalized)!;

  // An unrecognized value is shown as itself rather than silently relabelled
  // "Other" — a value nothing can score should look unusual, not settled.
  const label = category.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return {
    id: category,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    icon: "🏷️",
    badgeClass: "bg-muted text-foreground border-border/60",
    scorable: false,
  };
}
