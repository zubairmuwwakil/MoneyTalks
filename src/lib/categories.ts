/**
 * The ONE spend-category vocabulary.
 *
 * Every id below is a card-catalogue category token — the exact strings
 * `RuleMatcher.matches` compares against `predicate.categories`
 * (src/engine/cards-twin/RuleMatcher.ts). That is not a stylistic choice: the
 * comparison is `Array.includes` on raw strings, so a category the UI invents
 * is a category the engine silently declines to score.
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

export const CATEGORIES: CategoryDefinition[] = [
  { id: "dining", label: "Dining", icon: "🍔", scorable: true,
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  { id: "foodDelivery", label: "Food Delivery", icon: "🛵", scorable: true,
    badgeClass: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20" },
  { id: "grocery", label: "Groceries", icon: "🛒", scorable: true,
    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
  { id: "gasStation", label: "Gas", icon: "⛽", scorable: true,
    badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20" },
  { id: "evCharging", label: "EV Charging", icon: "🔌", scorable: true,
    badgeClass: "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/20" },
  { id: "transit", label: "Transit & Rideshare", icon: "🚇", scorable: true,
    badgeClass: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20" },
  { id: "travel", label: "Travel & Flights", icon: "✈️", scorable: true,
    badgeClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20" },
  { id: "lodging", label: "Hotels & Stays", icon: "🏨", scorable: true,
    badgeClass: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20" },
  { id: "marriottDirect", label: "Marriott (direct)", icon: "🛎️", scorable: true,
    badgeClass: "bg-indigo-600/10 text-indigo-800 dark:text-indigo-200 border-indigo-600/20" },
  { id: "carRental", label: "Car Rental", icon: "🚗", scorable: true,
    badgeClass: "bg-stone-500/10 text-stone-700 dark:text-stone-300 border-stone-500/20" },
  { id: "drugStore", label: "Drugstore & Health", icon: "💊", scorable: true,
    badgeClass: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20" },
  { id: "householdUtilities", label: "Utilities & Telecom", icon: "⚡", scorable: true,
    badgeClass: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20" },
  { id: "streaming", label: "Streaming", icon: "🍿", scorable: true,
    badgeClass: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20" },
  { id: "digitalMedia", label: "Digital Media & Software", icon: "💾", scorable: true,
    badgeClass: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/20" },
  { id: "entertainment", label: "Entertainment", icon: "🎬", scorable: true,
    badgeClass: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20" },
  { id: "memberships", label: "Memberships & Fitness", icon: "🎟️", scorable: true,
    badgeClass: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20" },
  { id: "ctFamily", label: "Canadian Tire family", icon: "🔧", scorable: true,
    badgeClass: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20" },
  { id: "retailShopping", label: "Retail & Shopping", icon: "🛍️", scorable: true,
    badgeClass: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20" },
  { id: "wholesaleClub", label: "Warehouse Clubs", icon: "📦", scorable: false,
    badgeClass: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20" },
  { id: "other", label: "General Merchandise", icon: "🏷️", scorable: false,
    badgeClass: "bg-muted text-muted-foreground border-border/60" },
];

const CATEGORY_MAP = new Map<string, CategoryDefinition>(CATEGORIES.map((cat) => [cat.id, cat]));

/**
 * Catalogue tokens that are real stored values but must NOT appear in a
 * picker. `recurring` matches on `PurchaseContext.recurringIndicator` alone
 * (RuleMatcher's `'recurring'` switch case), and
 * `ownerSelectedTangerineCategory` stands in for whatever the owner picked on
 * Tangerine — no purchase is ever "in" either, so offering them invites a
 * meaningless answer. Same posture as PickMe's `ruleSideMarkers`.
 */
export const RULE_SIDE_CATEGORY_TOKENS: ReadonlySet<string> = new Set([
  "recurring",
  "ownerSelectedTangerineCategory",
]);

/**
 * Pre-convergence ids, plus the loose synonyms that reached the DB through
 * `/settings/merchants` and old query strings. Kept forever, not until the
 * migration runs: a bookmarked `/purchases?category=groceries` must keep
 * working, and so must any row an import writes in the old vocabulary.
 */
export const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  groceries: "grocery",
  gas: "gasStation",
  gas_station: "gasStation",
  gasstation: "gasStation",
  ev: "evCharging",
  ev_charging: "evCharging",
  bills: "householdUtilities",
  utilities: "householdUtilities",
  utility: "householdUtilities",
  recurringbill: "householdUtilities",
  recurringbills: "householdUtilities",
  recurring_bill: "householdUtilities",
  recurring_bills: "householdUtilities",
  householdutilities: "householdUtilities",
  drugstore: "drugStore",
  pharmacy: "drugStore",
  hotel: "lodging",
  hotels: "lodging",
  flight: "travel",
  flights: "travel",
  digital_media: "digitalMedia",
  digitalmedia: "digitalMedia",
  food_delivery: "foodDelivery",
  fooddelivery: "foodDelivery",
  delivery: "foodDelivery",
  car_rental: "carRental",
  carrental: "carRental",
  warehouse: "wholesaleClub",
  wholesale: "wholesaleClub",
  wholesaleclub: "wholesaleClub",
  ct_family: "ctFamily",
  ctfamily: "ctFamily",
  marriott: "marriottDirect",
  marriottdirect: "marriottDirect",
  // Retail-ish buckets that never had an engine meaning. They collapse into
  // the catalogue's own general-merchandise token rather than surviving as a
  // second vocabulary — `other` is what PickMe calls "General merchandise".
  shopping: "other",
  retail: "other",
  general_retail: "other",
  home_improvement: "other",
  online_foreign: "other",
  everythingelse: "other",
  everything_else: "other",
  unknown: "other",
});

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
  if (CATEGORY_MAP.has(trimmed) || RULE_SIDE_CATEGORY_TOKENS.has(trimmed)) return trimmed;

  const lowered = trimmed.toLowerCase();
  if (LEGACY_CATEGORY_ALIASES[lowered]) return LEGACY_CATEGORY_ALIASES[lowered];

  // Case-only difference: "GROCERY", "gasstation", "drugstore" -> the token.
  const caseInsensitive = CATEGORIES.find((cat) => cat.id.toLowerCase() === lowered);
  if (caseInsensitive) return caseInsensitive.id;
  return null;
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
