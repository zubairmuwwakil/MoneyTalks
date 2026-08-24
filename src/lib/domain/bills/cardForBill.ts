import { RecommendationEngine } from "@/engine/cards-twin";
import { programDefaults } from "@/lib/contracts/cardCatalogue";
import type {
  Catalogue,
  Earn,
  OwnerState,
  PurchaseContext,
  Recommendation,
} from "@/engine/cards-twin";
import { convertMinor, MissingFxRateError, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";

/**
 * Maps a MoneyTalks `Bill` onto a card-recommendation `PurchaseContext` for
 * the cards-twin engine (src/engine/cards-twin — read-only here, CI-gated
 * against 27 Swift golden fixtures; nothing in that directory is touched by
 * this module), then runs the engine to answer "which of my cards should I
 * pay this bill with".
 *
 * ## The MCC trap this module exists to defuse
 * `RuleMatcher.matches` (src/engine/cards-twin/RuleMatcher.ts) has a
 * documented sharp edge: when an earn rule's predicate carries an
 * `mccInclude` list and the purchase's `mcc` is null/undefined, the
 * category-matching branch falls through to `true` — an *unknown* MCC is
 * treated as a MATCH, not a non-match:
 *
 *   if (p.mccInclude && purchase.mcc) {
 *     return p.mccInclude.includes(purchase.mcc);
 *   }
 *   return true; // <- no MCC supplied: matches unconditionally
 *
 * A `PurchaseContext` built without an MCC therefore silently qualifies for
 * every MCC-gated bonus rule that shares a `categories` entry with it (e.g.
 * MBNA's 5x on utilities/streaming/memberships) — a confidently WRONG
 * answer, not a conservative one, for nearly every bill.
 *
 * PickMe's Swift engine defuses exactly this with
 * `RecurringCategoryDefaults.representativeMcc`
 * (PickMe/Engine/Sources/CardCopilotEngine/Models/RecurringPayment.swift
 * ~L127), which has no TS twin. `REPRESENTATIVE_MCC` below is a direct port
 * — values are copied verbatim from Swift, which stays the source of truth
 * for the numbers it already covers. Every `PurchaseContext` this module
 * builds carries a non-null `mcc` from that table (`buildBillPurchaseContext`
 * never returns `ok: true` without one — see its test coverage), and every
 * caller is told the MCC was assumed, not observed, via `mccAssumed: true`
 * on the result. Per RecurringPayment.swift's own doc comment: a supplied
 * MCC must be *disclosed* to the user, not hidden.
 */

// --- Representative MCCs (ported from PickMe Swift; see module doc above) --
// Values copied verbatim from RecurringCategoryDefaults.representativeMcc.
// Swift is the source of truth for these numbers — don't "correct" one here
// without updating both sides.
export const REPRESENTATIVE_MCC: Readonly<Record<string, number>> = Object.freeze({
  streaming: 5968,
  digitalMedia: 5815,
  memberships: 7997,
  householdUtilities: 4814,
  recurring: 6300,
  transit: 4121,
  foodDelivery: 5814,
  grocery: 5411,
});

// --- Payment rail (can a card even pay this?) ------------------------------

/**
 * `Bill.paymentRail` answers a question `Bill.category` cannot: whether a
 * credit card can touch this bill at all, and at what pass-through cost.
 *
 * The two are genuinely orthogonal, and collapsing them into `category`
 * produced a confidently wrong answer. Durham Region water is a `utilities`
 * bill — a recommendable category, mapped to householdUtilities/MCC 4814 —
 * that accepts ONLY pre-authorized debit from a chequing/savings account.
 * Category answers "what kind of spend is this" (needed to pick an earn
 * rule); rail answers "can a card clear it" (needed to decide whether to
 * recommend at all).
 *
 * `unknown` (the column default) defers to the historical
 * `BILL_CATEGORY_MAPPING` behaviour verbatim, so bills whose rail nobody has
 * recorded yet behave exactly as they did before this dimension existed.
 * New behaviour only activates once a rail is actually on file.
 */
export type PaymentRail = "card" | "pad" | "card_via_third_party" | "unknown";

export const PAYMENT_RAILS: readonly PaymentRail[] = Object.freeze([
  "unknown",
  "card",
  "pad",
  "card_via_third_party",
] as const);

export interface BillRailInput {
  paymentRail?: string | null;
  /** Third-party pass-through surcharge, as a percentage (2.5 = 2.5%). */
  railFeePct?: number | null;
}

export type BillRailDecision =
  /** No rail on file — fall back to the category table's assumption. */
  | { gate: "defer-to-category" }
  /** A card cannot honestly pay this, whatever the category would earn. */
  | { gate: "blocked"; reason: "rail-not-card-payable" | "rail-fee-unknown"; rationale: string }
  /** A card can pay this, at `feePct` pass-through cost (0 for a direct rail). */
  | { gate: "allow"; rail: PaymentRail; feePct: number };

/**
 * Resolves the rail gate for a bill. Pure — no engine calls, no I/O.
 *
 * A `card_via_third_party` rail with no fee on file is BLOCKED rather than
 * treated as free: the whole reason that rail is distinct from `card` is
 * that it carries a surcharge, so assuming zero would reintroduce exactly
 * the over-promise this module exists to prevent.
 */
export function resolveBillPaymentRail(bill: BillRailInput): BillRailDecision {
  const rail = bill.paymentRail ?? "unknown";

  switch (rail) {
    case "pad":
      return {
        gate: "blocked",
        reason: "rail-not-card-payable",
        rationale:
          "This biller only accepts pre-authorized debit from a chequing or savings account, so no credit card can pay it — there is no reward rate to compare.",
      };
    case "card":
      return { gate: "allow", rail: "card", feePct: 0 };
    case "card_via_third_party": {
      const feePct = bill.railFeePct;
      if (feePct === null || feePct === undefined || !Number.isFinite(feePct)) {
        return {
          gate: "blocked",
          reason: "rail-fee-unknown",
          rationale:
            "This biller only takes a card through a third-party payment service, and no pass-through fee is on file — recommending a card would be guessing at the cost. Record the service's fee to get a real answer.",
        };
      }
      return { gate: "allow", rail: "card_via_third_party", feePct };
    }
    default:
      return { gate: "defer-to-category" };
  }
}

// --- Bill.category -> engine category mapping ------------------------------

export type BillCategoryDecision =
  | { recommend: true; engineCategory: string; rationale: string }
  | {
      recommend: false;
      reason: "excluded-category" | "unmapped-category" | "override-mcc-unknown";
      rationale: string;
    };

/**
 * `Bill.category` (Prisma: housing | utilities | subscriptions | transport |
 * debt | other) uses a different, coarser vocabulary than the engine's
 * earn-rule categories. Every entry below is a deliberate, documented
 * choice — a future reader should be able to audit this table without
 * re-deriving it.
 */
export const BILL_CATEGORY_MAPPING: Readonly<Record<string, BillCategoryDecision>> = Object.freeze({
  // Mortgage/rent payments generally can't be charged to a credit card at
  // all; where a third-party rent-collection/bill-pay workaround exists, it
  // typically charges ~2-2.5% per transaction — a cost that swamps every
  // reward rate in this catalogue for a payment that isn't in any bonus
  // category to begin with. A card pick here would be a confidently wrong
  // answer, not a helpful one, so this renders an explanatory line instead.
  housing: {
    recommend: false,
    reason: "excluded-category",
    rationale:
      "Mortgage/rent payments generally aren't chargeable to a card directly, and the third-party services that allow it typically charge ~2-2.5% per transaction — more than any reward on offer here. No honest recommendation exists.",
  },
  // Same economics as housing: loan/LOC/credit-card-debt paydowns don't
  // clear card networks directly, and the surcharge-service workaround
  // costs more than any reward this catalogue offers.
  debt: {
    recommend: false,
    reason: "excluded-category",
    rationale:
      "Debt payments (loans, lines of credit) face the same non-chargeable-or-surcharged economics as housing — no card reward here beats a ~2-2.5% pass-through fee.",
  },
  // Direct match: MoneyTalks "utilities" (phone/internet/hydro/etc.) is
  // exactly PickMe's householdUtilities bucket.
  utilities: {
    recommend: true,
    engineCategory: "householdUtilities",
    rationale:
      'Direct match — "utilities" bills (phone/internet/hydro/etc.) are exactly PickMe\'s householdUtilities bucket.',
  },
  // Direct match: transit passes/tolls.
  transport: {
    recommend: true,
    engineCategory: "transit",
    rationale: 'Direct match — "transport" bills (transit passes, tolls) map onto the engine\'s transit category.',
  },
  // Genuinely ambiguous: a generic "subscriptions" bill could be Netflix
  // (streaming), iCloud/Dropbox/SaaS (digitalMedia), or a gym app
  // (memberships). CONSERVATIVE pick: digitalMedia, not streaming.
  // All three candidates tie at MBNA's 5x when MBNA is owned
  // (mbna-digital-media-5x's predicate covers both streaming AND
  // digitalMedia at the same rate; mbna-memberships-5x mirrors it for
  // memberships). The one place they diverge: Amex Cobalt's
  // cobalt-streaming-3x rule matches on the "streaming" category ALONE (no
  // mccInclude gate at all), so mapping every generic subscription to
  // "streaming" would hand a Cobalt-only owner a 3x bonus for something
  // that might actually be a non-video subscription — an over-promise.
  // digitalMedia and memberships both avoid that false positive;
  // digitalMedia is chosen over memberships as the closer semantic fit for
  // a generic "subscriptions" bill (software/cloud/media) vs. memberships
  // (gym/club dues).
  subscriptions: {
    recommend: true,
    engineCategory: "digitalMedia",
    rationale:
      'Ambiguous (streaming vs. digitalMedia vs. memberships) — conservatively mapped to digitalMedia: ties with the others at MBNA\'s 5x, but unlike "streaming" it never falsely qualifies for Amex Cobalt\'s streaming-only 3x bonus on a subscription that might not be video streaming.',
  },
  // Catch-all. Maps to the engine's own "recurring" pseudo-category, which
  // matches purely on PurchaseContext.recurringIndicator (see
  // RuleMatcher.matches's 'recurring' switch case) — it is deliberately
  // MCC-agnostic, so an uncategorized bill never risks a false MCC-gated
  // bonus. This is the same choice PickMe's own reference data
  // (RecurringPlan.placeholderSubscriptions) uses for its miscellaneous
  // recurring bills (insurance).
  other: {
    recommend: true,
    engineCategory: "recurring",
    rationale:
      'Catch-all — mapped to the engine\'s MCC-agnostic "recurring" pseudo-category (matches on recurringIndicator alone, never on MCC), the same choice PickMe\'s reference data uses for its own miscellaneous recurring bills.',
  },
});

/**
 * Resolves which engine category applies to a bill. Pure and side-effect
 * free — no engine calls, no I/O.
 *
 * `opts.override`, when supplied, wins over the derived `Bill.category`
 * mapping above. This is the seam a future per-bill "pin the spend
 * category" feature hangs off (a planned, not-yet-added nullable `Bill`
 * column, tracked separately) — this function doesn't know about that
 * column; it just accepts whatever engine category string the caller
 * already resolved for the bill and trusts it over the derived table.
 */
export function resolveBillSpendCategory(
  bill: Pick<{ category: string }, "category">,
  opts: { override?: string } = {},
): BillCategoryDecision & { source: "override" | "derived" } {
  if (opts.override) {
    const mcc = REPRESENTATIVE_MCC[opts.override];
    if (mcc === undefined) {
      return {
        recommend: false,
        reason: "override-mcc-unknown",
        rationale: `No representative MCC is known for overridden engine category "${opts.override}" — refusing to build a context with a null MCC.`,
        source: "override",
      };
    }
    return {
      recommend: true,
      engineCategory: opts.override,
      rationale: "Explicit engine-category override supplied by the caller; takes precedence over the derived Bill.category mapping.",
      source: "override",
    };
  }

  const mapping = BILL_CATEGORY_MAPPING[bill.category];
  if (!mapping) {
    return {
      recommend: false,
      reason: "unmapped-category",
      rationale: `Unrecognized bill category "${bill.category}" — no documented mapping, so no recommendation is produced.`,
      source: "derived",
    };
  }
  return { ...mapping, source: "derived" };
}

// --- Spend-category picker options ------------------------------------------

export interface SpendCategoryOption {
  value: string;
  label: string;
}

// A handful of catalogue category codes don't read well as
// `camelCase -> Title Case`; everything else falls through to that
// mechanical transform below rather than needing its own entry here.
const SPEND_CATEGORY_LABEL_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  householdUtilities: "Household utilities",
  digitalMedia: "Digital media / software",
  foodDelivery: "Food delivery",
  recurring: "Other recurring (no specific category)",
});

function humanizeSpendCategory(engineCategory: string): string {
  if (SPEND_CATEGORY_LABEL_OVERRIDES[engineCategory]) return SPEND_CATEGORY_LABEL_OVERRIDES[engineCategory];
  const spaced = engineCategory.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The engine-category options a bill's `spendCategory` picker should offer,
 * derived from the catalogue actually loaded rather than hardcoded — a
 * hardcoded list has already gone stale here once (see module doc). Two
 * filters apply:
 *
 * 1. Only categories that appear as a `predicate.categories` entry on at
 *    least one real earn rule in `catalogue` — this is the catalogue's own
 *    vocabulary, so a category the catalogue drops disappears from the
 *    picker automatically, and one it gains appears once (2) below is also
 *    satisfied for it.
 * 2. Only categories with a known `REPRESENTATIVE_MCC` entry. Without one,
 *    `resolveBillSpendCategory`/`buildBillPurchaseContext` refuse the
 *    override outright ("override-mcc-unknown") — offering it as a choice
 *    would be a UI dead end, a pin that can never honestly resolve. This
 *    also naturally restricts the list to the *recurring-bill-shaped*
 *    categories (streaming, memberships, utilities, ...) rather than
 *    one-off purchase categories (dining, carRental, lodging, ...) that a
 *    bill would never actually be — those simply have no representative
 *    MCC because nothing in this domain needed one for them.
 */
export function billSpendCategoryOptions(catalogue: Catalogue): SpendCategoryOption[] {
  const seen = new Set<string>();
  for (const card of catalogue.cards) {
    for (const rule of card.earnRules) {
      for (const category of rule.predicate.categories ?? []) {
        seen.add(category);
      }
    }
  }
  return [...seen]
    .filter((category) => REPRESENTATIVE_MCC[category] !== undefined)
    .sort()
    .map((category) => ({ value: category, label: humanizeSpendCategory(category) }));
}

// --- PurchaseContext construction -------------------------------------------

export interface BillForContext extends BillRailInput {
  category: string;
  currency: string;
  variable: boolean;
}

export interface NextOccurrenceForContext {
  /** In `bill.currency`'s minor units — same convention as `ScheduleEntry.amountMinor`. */
  amountMinor: number;
}

export type BillContextSkipReason =
  | "excluded-category"
  | "unmapped-category"
  | "override-mcc-unknown"
  | "fx-rate-unavailable";

/**
 * Every reason `recommendCardForBill` can decline. A superset of
 * `BillContextSkipReason`: the rail verdicts are decided outside
 * `buildBillPurchaseContext` — `rail-fee-exceeds-reward` in particular can
 * only be reached AFTER scoring, since it compares the pass-through fee
 * against what the winning card actually earns.
 */
export type BillSkipReason =
  | BillContextSkipReason
  | "rail-not-card-payable"
  | "rail-fee-unknown"
  | "rail-fee-exceeds-reward";

export type BillContextResult =
  | {
      ok: true;
      context: PurchaseContext;
      engineCategory: string;
      mcc: number;
      /** Always true: this module never supplies an observed MCC, only a representative one — see module doc. */
      mccAssumed: true;
      mappingRationale: string;
      categorySource: "override" | "derived";
    }
  | { ok: false; reason: BillContextSkipReason; detail: string };

/**
 * Builds the `PurchaseContext` the engine needs to score this bill, or
 * explains why none can be honestly built.
 *
 * FX handling: when `bill.currency !== "CAD"`, the amount is converted to a
 * CAD-equivalent via the existing FX engine (src/engine/fx.ts) using
 * whatever rates the caller has on file. If no usable rate exists, this
 * returns `ok: false` rather than silently treating the foreign amount as
 * CAD. `context.currency` is deliberately left as the bill's REAL
 * transaction currency (not rewritten to "CAD") so the engine's own Scorer
 * still applies the card's foreign-transaction fee/allowance — see
 * cards-twin/Scorer.ts's `currency !== 'CAD'` branch. Silently relabeling an
 * FX'd amount as a CAD purchase would suppress that fee model entirely.
 */
export function buildBillPurchaseContext(
  bill: BillForContext,
  next: NextOccurrenceForContext,
  rates: FxRateInput[],
  opts: { override?: string } = {},
): BillContextResult {
  const decision = resolveBillSpendCategory(bill, opts);
  if (!decision.recommend) {
    return { ok: false, reason: decision.reason, detail: decision.rationale };
  }

  const mcc = REPRESENTATIVE_MCC[decision.engineCategory];
  // Should be unreachable: `resolveBillSpendCategory` only returns
  // `recommend: true` after confirming REPRESENTATIVE_MCC has an entry
  // (directly, for overrides; by construction, for every BILL_CATEGORY_MAPPING
  // entry below). Guarded anyway — a context with a null MCC is exactly the
  // bug this module exists to prevent (see module doc).
  if (mcc === undefined) {
    return {
      ok: false,
      reason: "unmapped-category",
      detail: `Internal: engine category "${decision.engineCategory}" has no representative MCC.`,
    };
  }

  const billCurrency = bill.currency.toUpperCase();
  let amountCad = next.amountMinor / 100;
  if (billCurrency !== "CAD") {
    try {
      const convertedMinor = convertMinor(next.amountMinor, billCurrency as Currency, "CAD", rates);
      amountCad = convertedMinor / 100;
    } catch (e) {
      if (e instanceof MissingFxRateError) {
        return {
          ok: false,
          reason: "fx-rate-unavailable",
          detail: `No FX rate on file to convert ${billCurrency} to CAD for this bill — skipping rather than guessing.`,
        };
      }
      throw e;
    }
  }

  const context: PurchaseContext = {
    amountCad,
    currency: billCurrency,
    category: decision.engineCategory,
    mcc,
    recurringIndicator: true,
    channel: "online",
  };

  return {
    ok: true,
    context,
    engineCategory: decision.engineCategory,
    mcc,
    mccAssumed: true,
    mappingRationale: decision.rationale,
    categorySource: decision.source,
  };
}

// --- Orchestration: run the engine and shape a UI-ready result -------------

export interface BillCardPick {
  cardId: string;
  cardName: string;
  network: string;
  earn: Earn;
  earnDescription: string;
  netValueCad: number;
}

export type BillRecommendationResult =
  | { status: "no-cards" }
  | { status: "no-upcoming-occurrence" }
  | { status: "skipped"; reason: BillSkipReason; detail: string }
  | { status: "engine-error"; detail: string }
  | {
      status: "recommended";
      winner: BillCardPick;
      runnerUp: BillCardPick | null;
      /** True when the winner doesn't clearly beat the runner-up by the owner's own switch-threshold bar — show both rather than projecting false confidence. */
      isClose: boolean;
      gapCad: number | null;
      engineCategory: string;
      mcc: number;
      mccAssumed: true;
      mappingRationale: string;
      categorySource: "override" | "derived";
      amountCad: number;
      amountIsEstimate: boolean;
      currency: string;
      /** The rail this answer is valid for; "unknown" means nobody recorded one. */
      paymentRail: PaymentRail;
      /** Pass-through surcharge in CAD for this occurrence. 0 unless the rail is `card_via_third_party`. */
      railFeeCad: number;
      /** `winner.netValueCad - railFeeCad` — what paying by card is really worth here. */
      netValueAfterFeeCad: number;
      recommendation: Recommendation;
    };

function describeEarn(earn: Earn): string {
  switch (earn.type) {
    case "points":
      return `${earn.pointsPerCad}x points`;
    case "cashback": {
      const pct = earn.rate * 100;
      return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}% cash back`;
    }
    case "centsPerLitre":
      return "fuel rate";
  }
}

function toPick(
  catalogue: Catalogue,
  score: { cardId: string; appliedRuleId: string | null; netValueCad: number },
): BillCardPick {
  const card = catalogue.cards.find((c) => c.cardId === score.cardId);
  if (!card) {
    // Unreachable in practice: `score.cardId` always comes from scoring
    // `catalogue.cards` itself (see recommendCardForBill below).
    throw new Error(`recommendCardForBill: winning cardId "${score.cardId}" is not in the scored catalogue`);
  }
  const rule = card.earnRules.find((r) => r.ruleId === score.appliedRuleId);
  return {
    cardId: card.cardId,
    cardName: card.officialName,
    network: card.network,
    earn: rule ? rule.earn : { type: "cashback", rate: 0 },
    earnDescription: rule ? describeEarn(rule.earn) : "base rate",
    netValueCad: score.netValueCad,
  };
}

/**
 * The full "which card should I pay this bill with" answer: resolves the
 * bill's engine category + MCC, builds a `PurchaseContext`, and scores it
 * against the owner's OWN cards.
 *
 * Scoping to owned cards is a deliberate choice, not something
 * `RecommendationEngine` does for you: it scores whatever `catalogue.cards`
 * it's handed (mirroring the Swift engine's `recommend`, which does the
 * same) and never consults `ownerState.ownedCardIds` itself. The
 * wallet-events route (src/app/api/v1/wallet-events/route.ts) deliberately
 * passes the FULL catalogue there, because it's answering "would a
 * different card have earned more" for owner awareness — a card the owner
 * doesn't hold isn't an actionable answer for THIS feature ("pay with
 * which of my cards"), so the catalogue is filtered here before scoring.
 */
export function recommendCardForBill(
  catalogue: Catalogue,
  ownerState: OwnerState | null,
  bill: BillForContext,
  next: NextOccurrenceForContext | null,
  rates: FxRateInput[],
  asOfISODate: string,
  opts: { override?: string } = {},
): BillRecommendationResult {
  // Category exclusion (housing/debt, or an unmapped category) is a
  // structural fact about the BILL — it doesn't depend on whether the owner
  // has cards on file or an upcoming occurrence, so it's checked first. This
  // guarantees the housing/debt "no honest recommendation exists" line (task
  // requirement: don't hedge it into a weak recommendation) always shows for
  // those categories, rather than being pre-empted by an unrelated "no
  // cards" or "no upcoming occurrence" result.
  // The rail gate runs FIRST and for the same reason category exclusion did:
  // "this biller cannot be paid by card" is a structural fact about the
  // BILL, independent of the owner's wallet or the next due date. A PAD-only
  // biller must say so rather than being pre-empted by "no cards on file".
  const rail = resolveBillPaymentRail(bill);
  if (rail.gate === "blocked") {
    return { status: "skipped", reason: rail.reason, detail: rail.rationale };
  }

  const decision = resolveBillSpendCategory(bill, opts);
  // A rail that explicitly accepts a card overrides the category table's
  // *chargeability* assumption — which is all the housing/debt exclusion
  // ever was. Those categories still have no engine mapping of their own, so
  // the bill scores as the MCC-agnostic "recurring" catch-all rather than a
  // guessed bonus category (same reasoning as BILL_CATEGORY_MAPPING.other).
  // An explicit spendCategory pin still outranks this fallback.
  const railFallback =
    !decision.recommend && decision.reason === "excluded-category" && rail.gate === "allow";
  if (!decision.recommend && !railFallback) {
    return { status: "skipped", reason: decision.reason, detail: decision.rationale };
  }
  const effectiveOpts = railFallback && !opts.override ? { ...opts, override: "recurring" } : opts;

  if (!ownerState || ownerState.ownedCardIds.length === 0) {
    return { status: "no-cards" };
  }
  if (!next) {
    return { status: "no-upcoming-occurrence" };
  }

  const built = buildBillPurchaseContext(bill, next, rates, effectiveOpts);
  if (!built.ok) {
    return { status: "skipped", reason: built.reason, detail: built.detail };
  }

  const ownedCatalogue: Catalogue = {
    ...catalogue,
    cards: catalogue.cards.filter((c) => ownerState.ownedCardIds.includes(c.cardId)),
  };

  let recommendation: Recommendation;
  try {
    const engine = new RecommendationEngine(ownedCatalogue, ownerState, programDefaults);
    recommendation = engine.recommend(built.context, asOfISODate);
  } catch (e) {
    return { status: "engine-error", detail: e instanceof Error ? e.message : String(e) };
  }

  const winner = toPick(ownedCatalogue, recommendation.winner);
  const runnerUp = recommendation.runnerUp ? toPick(ownedCatalogue, recommendation.runnerUp) : null;

  let isClose = false;
  let gapCad: number | null = null;
  if (runnerUp) {
    gapCad = winner.netValueCad - runnerUp.netValueCad;
    // Mirrors RecommendationEngine.rank's own clears-threshold arithmetic
    // (cards-twin is read-only, so this is reimplemented rather than
    // imported) — reusing the owner's OWN switch-threshold bar to decide
    // "close" keeps this consistent with what the engine itself considers
    // a meaningful advantage, instead of inventing a new magic number.
    const t = ownerState.switchThreshold;
    const ppFloorCad = built.context.amountCad > 0 ? (t.minAdvantagePercentagePoints * built.context.amountCad) / 100 : 0;
    const cadOk = gapCad >= t.minAdvantageCad;
    const ppOk = gapCad >= ppFloorCad;
    const clears = t.semantics === "either" ? cadOk || ppOk : cadOk && ppOk;
    isClose = !clears;
  }

  // The pass-through fee is a flat cost on the OCCURRENCE, identical for
  // every candidate card, so it can never reorder them — `isClose`, `gapCad`
  // and every downstream allocation delta stay fee-invariant on purpose. All
  // it can change is the go/no-go against simply paying from a bank account.
  const feePct = rail.gate === "allow" ? rail.feePct : 0;
  const railFeeCad = (feePct / 100) * built.context.amountCad;
  const netValueAfterFeeCad = winner.netValueCad - railFeeCad;
  if (railFeeCad > 0 && netValueAfterFeeCad <= 0) {
    return {
      status: "skipped",
      reason: "rail-fee-exceeds-reward",
      detail:
        `Paying this by card costs a ${feePct}% third-party fee ($${railFeeCad.toFixed(2)}) but the best owned card ` +
        `only earns $${winner.netValueCad.toFixed(2)} on it — $${Math.abs(netValueAfterFeeCad).toFixed(2)} worse than ` +
        `paying it straight from a bank account. No honest card recommendation exists.`,
    };
  }

  return {
    status: "recommended",
    winner,
    runnerUp,
    isClose,
    gapCad,
    engineCategory: built.engineCategory,
    mcc: built.mcc,
    mccAssumed: true,
    mappingRationale: railFallback
      ? `This bill's category has no card-chargeable mapping of its own, but its payment rail is recorded as card-payable — so it is scored as generic recurring spend (MCC-agnostic, never a guessed bonus category).`
      : built.mappingRationale,
    categorySource: railFallback ? "derived" : built.categorySource,
    amountCad: built.context.amountCad,
    amountIsEstimate: bill.variable,
    currency: built.context.currency,
    paymentRail: rail.gate === "allow" ? rail.rail : "unknown",
    railFeeCad,
    netValueAfterFeeCad,
    recommendation,
  };
}
