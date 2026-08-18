import type { BillRecommendationResult } from "./cardForBill";

/**
 * Per-bill "is the card I actually pay this with the best owned card"
 * accounting — the payoff feature described in the per-bill-allocation spec:
 * a bills-page header line like "4 of 12 bills are on a suboptimal card —
 * about $73/yr left on the table."
 *
 * This module is deliberately downstream of `cardForBill.ts`'s
 * `recommendCardForBill` rather than re-running the engine itself: it takes
 * the `BillRecommendationResult` the caller already computed (bills/page.tsx
 * and bills/[id]/page.tsx both already call `recommendCardForBill` per bill
 * to render the "pay with" hint) and layers the allocation comparison on
 * top, so there is exactly one place that talks to `RecommendationEngine`.
 *
 * "Best owned card" here means the actual highest-`netValueCad` candidate
 * among `recommendation.allCandidates` — NOT `recommendation.winner`.
 * `RecommendationEngine.recommend`'s `winner` is switch-threshold-aware (it
 * can stick with the owner's default card even when a better one exists, to
 * avoid nagging over a marginal one-purchase edge — see
 * RecommendationEngine.rank's `suppressedBetterCard` handling). That
 * friction is the right behavior for a single "should I switch for this
 * purchase" nudge, but it is the WRONG number for "how much value is this
 * bill leaving on the table every year" — that question wants the true
 * economic gap, independent of whether the engine would bother recommending
 * a switch. `allCandidates` gives every non-excluded owned card's real
 * `netValueCad`, so the max over that list is used instead.
 */

export type BillAllocationStatus =
  /** The bill itself has no honest recommendation (housing/debt, unmapped
   *  category, no upcoming occurrence, no FX rate, or an engine error) —
   *  the allocation question doesn't apply, regardless of whether a card is
   *  even assigned. */
  | "excluded"
  /** `paymentCardId` is null — the bill has a recommendation but no card is
   *  allocated yet. */
  | "unallocated"
  /** A card is allocated but can't be scored: its `contractCardId` is null
   *  (never linked to the catalogue — see /settings/wallet), or it was
   *  excluded by the engine (e.g. a stale owner-state snapshot, or an
   *  unresolved owner condition) and so never appears among
   *  `allCandidates`. */
  | "unscoreable"
  /** The allocated card IS the best-scoring owned card for this bill
   *  (within a fraction-of-a-cent floating tolerance) — delta is exactly
   *  zero and this bill contributes nothing to the total, on purpose. */
  | "optimal"
  /** The allocated card scores below the best owned card — contributes
   *  `annualDeltaCad` to the total. */
  | "suboptimal";

export interface BillAllocationInput {
  billId: string;
  /** Whatever `recommendCardForBill` already returned for this bill. */
  rec: BillRecommendationResult;
  /** `Bill.paymentCardId` — the user's own `CreditCard.id`, or null. */
  paymentCardId: string | null;
  /** The allocated `CreditCard.contractCardId` — the engine-catalogue
   *  identity `recommendation.allCandidates` scores against. Pass null when
   *  `paymentCardId` is null OR the allocated card's `contractCardId` is
   *  null (unlinked). */
  paymentCardContractId: string | null;
  /** `billOccurrences(...).length` over the next 12 months — how many times
   *  this bill's per-occurrence value gap actually recurs in a year. */
  occurrenceCount12mo: number;
  /** `Bill.variable` — the amount driving the per-occurrence gap is an
   *  estimate, not an observed figure. */
  amountIsEstimate: boolean;
}

export interface BillAllocationResult {
  billId: string;
  status: BillAllocationStatus;
  /** Set only for "optimal" (always 0) and "suboptimal". Null for every
   *  other status — deliberately, so a caller summing this field can never
   *  mistake "not applicable" for "zero dollars lost". */
  annualDeltaCad: number | null;
  /** Engine cardId of the best owned+scoreable card, when known. */
  bestCardId: string | null;
  amountIsEstimate: boolean;
  detail: string;
}

// Floating-point floor below which a nonzero netValueCad difference is
// treated as "the same card" rather than a razor-thin "suboptimal" — avoids
// a $0.0000001 rounding artifact flipping a bill's status.
const OPTIMAL_TOLERANCE_CAD = 0.005;

export function computeBillAllocation(input: BillAllocationInput): BillAllocationResult {
  const { billId, rec, paymentCardId, paymentCardContractId, occurrenceCount12mo, amountIsEstimate } = input;

  if (rec.status !== "recommended") {
    return {
      billId,
      status: "excluded",
      annualDeltaCad: null,
      bestCardId: null,
      amountIsEstimate,
      detail:
        rec.status === "skipped"
          ? rec.detail
          : `No recommendation is available for this bill (${rec.status}).`,
    };
  }

  if (!paymentCardId) {
    return {
      billId,
      status: "unallocated",
      annualDeltaCad: null,
      bestCardId: rec.winner.cardId,
      amountIsEstimate,
      detail: "No card is allocated to this bill yet.",
    };
  }

  if (!paymentCardContractId) {
    return {
      billId,
      status: "unscoreable",
      annualDeltaCad: null,
      bestCardId: rec.winner.cardId,
      amountIsEstimate,
      detail: "The allocated card isn't linked to the catalogue, so it can't be scored — link it under Settings → Apple Wallet.",
    };
  }

  const candidates = rec.recommendation.allCandidates;
  const allocated = candidates.find((c) => c.cardId === paymentCardContractId);
  if (!allocated) {
    return {
      billId,
      status: "unscoreable",
      annualDeltaCad: null,
      bestCardId: rec.winner.cardId,
      amountIsEstimate,
      detail: "The allocated card could not be scored for this bill.",
    };
  }

  const best = candidates.reduce((a, b) => (b.netValueCad > a.netValueCad ? b : a));
  const perOccurrenceGapCad = Math.max(0, best.netValueCad - allocated.netValueCad);

  if (perOccurrenceGapCad <= OPTIMAL_TOLERANCE_CAD) {
    return {
      billId,
      status: "optimal",
      annualDeltaCad: 0,
      bestCardId: best.cardId,
      amountIsEstimate,
      detail: "Already on the best owned card for this bill.",
    };
  }

  return {
    billId,
    status: "suboptimal",
    annualDeltaCad: perOccurrenceGapCad * occurrenceCount12mo,
    bestCardId: best.cardId,
    amountIsEstimate,
    detail: `The best owned card (${best.cardId}) earns ${perOccurrenceGapCad.toFixed(2)} CAD more per occurrence.`,
  };
}

export interface BillAllocationSummary {
  totalBills: number;
  suboptimalCount: number;
  optimalCount: number;
  excludedCount: number;
  unallocatedCount: number;
  unscoreableCount: number;
  /** Sum of `annualDeltaCad` over "suboptimal" bills only. Excluded,
   *  unallocated, and unscoreable bills are never folded into this as
   *  zero — they're counted separately above instead. */
  annualDeltaCad: number;
  /** True when at least one bill contributing to `annualDeltaCad` has an
   *  estimated (variable) amount — the caller should hedge the total with
   *  "about"/"roughly" rather than presenting it as exact. */
  includesEstimate: boolean;
}

export function summarizeBillAllocations(results: BillAllocationResult[]): BillAllocationSummary {
  const summary: BillAllocationSummary = {
    totalBills: results.length,
    suboptimalCount: 0,
    optimalCount: 0,
    excludedCount: 0,
    unallocatedCount: 0,
    unscoreableCount: 0,
    annualDeltaCad: 0,
    includesEstimate: false,
  };

  for (const r of results) {
    switch (r.status) {
      case "suboptimal":
        summary.suboptimalCount += 1;
        summary.annualDeltaCad += r.annualDeltaCad ?? 0;
        if (r.amountIsEstimate) summary.includesEstimate = true;
        break;
      case "optimal":
        summary.optimalCount += 1;
        break;
      case "excluded":
        summary.excludedCount += 1;
        break;
      case "unallocated":
        summary.unallocatedCount += 1;
        break;
      case "unscoreable":
        summary.unscoreableCount += 1;
        break;
    }
  }

  return summary;
}
