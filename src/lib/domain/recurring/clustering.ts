import type { CadenceInferenceResult, AmountPatternResult, Observation } from "./types";
import { inferAmountPattern } from "./amountPattern";
import { inferCadence } from "./cadenceInference";

const DAY_MS = 86_400_000;
const MIN_SERIES_AMID_NOISE = 5;

/**
 * Identity has already been resolved by the ingestion/orchestration boundary.
 * Keeping that boundary explicit lets this module remain pure: in particular,
 * it must not query MerchantAlias or invent a second merchant resolver.
 */
export interface ClusteringPurchase extends Observation {
  id: string;
  userId: string;
  canonicalMerchantId: string;
  /** Email-derived account or plan evidence only. Null is the common case. */
  discriminator?: string | null;
}

export interface CandidateCluster<Purchase extends ClusteringPurchase = ClusteringPurchase> {
  userId: string;
  canonicalMerchantId: string;
  currency: string;
  discriminator: string | null;
  /** Exactly the evidence selected for this series, in chronological order. */
  purchases: Purchase[];
  cadence: CadenceInferenceResult;
  amountPattern: AmountPatternResult;
}

interface SearchWindow {
  periodDays: number;
  toleranceDays: number;
  type: CadenceInferenceResult["cadence"]["type"];
}

interface QualifiedSeries<Purchase extends ClusteringPurchase> {
  purchases: Purchase[];
  cadence: CadenceInferenceResult;
  amountPattern: AmountPatternResult;
}

// These are search windows, not acceptance rules. inferCadence remains the
// single authority that decides whether a generated subset is recurring.
const SEARCH_WINDOWS: readonly SearchWindow[] = [
  { periodDays: 7, toleranceDays: 2, type: "WEEKLY" },
  { periodDays: 14, toleranceDays: 4, type: "BIWEEKLY" },
  { periodDays: 30, toleranceDays: 4, type: "MONTHLY" },
  { periodDays: 91, toleranceDays: 10, type: "QUARTERLY" },
  { periodDays: 182, toleranceDays: 10, type: "SEMIANNUAL" },
  { periodDays: 365, toleranceDays: 10, type: "ANNUAL" },
];

function validatePurchases(purchases: readonly ClusteringPurchase[], timeZone: string): void {
  // Validate even an empty/single-occurrence sweep so bad orchestration cannot
  // hide behind the minimum evidence threshold.
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(0));

  const ids = new Set<string>();
  for (const purchase of purchases) {
    if (!purchase.id || !purchase.userId || !purchase.canonicalMerchantId || !purchase.currency) {
      throw new RangeError("clustering identity fields must be non-empty strings");
    }
    if (ids.has(purchase.id)) throw new RangeError(`duplicate clustering purchase id: ${purchase.id}`);
    ids.add(purchase.id);
    if (!Number.isFinite(purchase.date.getTime())) {
      throw new RangeError("clustering dates must be valid Dates");
    }
    // null is valid and expected — a biller whose mail never states a price
    // (see Observation.amountMinor) still produces dated observations, and
    // cadence is inferred from dates alone. Only a present amount must be a
    // safe integer in minor units.
    if (purchase.amountMinor !== null && !Number.isSafeInteger(purchase.amountMinor)) {
      throw new RangeError("clustering amounts must be safe integers in minor units, or null");
    }
  }
}

function localOrdinal(date: Date, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isInteger(value)) throw new RangeError(`could not read ${type} from clustering date`);
    return value;
  };
  return Math.trunc(Date.UTC(read("year"), read("month") - 1, read("day")) / DAY_MS);
}

function comparePurchases(a: ClusteringPurchase, b: ClusteringPurchase): number {
  // Amount is only a tiebreak here, and an unpriced observation still needs a
  // total order — id breaks the remaining tie deterministically.
  return a.date.getTime() - b.date.getTime()
    || (a.amountMinor ?? 0) - (b.amountMinor ?? 0)
    || a.id.localeCompare(b.id);
}

function identityKey(purchase: ClusteringPurchase): string {
  return JSON.stringify([
    purchase.userId,
    purchase.canonicalMerchantId,
    purchase.currency,
    purchase.discriminator ?? null,
  ]);
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

/**
 * Start at one observation and walk the cadence grid. At each expected point,
 * take at most one observation: closest date first, then closest amount to the
 * series so far. Amount is only a deterministic tie-break; it never partitions
 * the bucket, so variable utilities remain discoverable.
 */
function extendSeed<Purchase extends ClusteringPurchase>(
  ordered: readonly Purchase[],
  ordinals: ReadonlyMap<string, number>,
  anchorIndex: number,
  window: SearchWindow,
): Purchase[] {
  const selected = [ordered[anchorIndex]];
  let cursorIndex = anchorIndex;

  while (cursorIndex < ordered.length - 1) {
    const cursorOrdinal = ordinals.get(ordered[cursorIndex].id)!;
    let elapsedPeriods = 1;
    let bestIndex = -1;

    while (bestIndex === -1) {
      const expected = cursorOrdinal + elapsedPeriods * window.periodDays;
      if (expected - window.toleranceDays > ordinals.get(ordered.at(-1)!.id)!) break;

      // An unpriced series (see Observation.amountMinor) has no representative
      // amount, so the amount tiebreak below is skipped and date error plus id
      // decide. Inventing a stand-in figure here would silently rank
      // candidates on a number nobody sent us.
      const selectedAmounts = selected
        .map((purchase) => purchase.amountMinor)
        .filter((amount): amount is number => amount !== null);
      const representativeAmount = selectedAmounts.length > 0 ? median(selectedAmounts) : null;
      for (let candidateIndex = cursorIndex + 1; candidateIndex < ordered.length; candidateIndex += 1) {
        const candidate = ordered[candidateIndex];
        const dateError = Math.abs(ordinals.get(candidate.id)! - expected);
        if (dateError > window.toleranceDays) continue;
        if (bestIndex === -1) {
          bestIndex = candidateIndex;
          continue;
        }

        const incumbent = ordered[bestIndex];
        const incumbentDateError = Math.abs(ordinals.get(incumbent.id)! - expected);
        const amountError = (purchase: ClusteringPurchase) =>
          representativeAmount === null || purchase.amountMinor === null
            ? 0
            : Math.abs(purchase.amountMinor - representativeAmount);
        const candidateAmountError = amountError(candidate);
        const incumbentAmountError = amountError(incumbent);
        if (
          dateError < incumbentDateError
          || (dateError === incumbentDateError && candidateAmountError < incumbentAmountError)
          || (
            dateError === incumbentDateError
            && candidateAmountError === incumbentAmountError
            && comparePurchases(candidate, incumbent) < 0
          )
        ) {
          bestIndex = candidateIndex;
        }
      }

      if (bestIndex === -1) elapsedPeriods += 1;
    }

    if (bestIndex === -1) break;
    selected.push(ordered[bestIndex]);
    cursorIndex = bestIndex;
  }

  return selected;
}

function compareSeries<Purchase extends ClusteringPurchase>(
  candidate: QualifiedSeries<Purchase>,
  incumbent: QualifiedSeries<Purchase>,
): number {
  if (candidate.purchases.length !== incumbent.purchases.length) {
    return candidate.purchases.length - incumbent.purchases.length;
  }
  if (candidate.cadence.coverage !== incumbent.cadence.coverage) {
    return candidate.cadence.coverage - incumbent.cadence.coverage;
  }
  if (candidate.cadence.mad !== incumbent.cadence.mad) {
    return incumbent.cadence.mad - candidate.cadence.mad;
  }
  const candidateStart = candidate.purchases[0].date.getTime();
  const incumbentStart = incumbent.purchases[0].date.getTime();
  if (candidateStart !== incumbentStart) return incumbentStart - candidateStart;
  return incumbent.purchases.map(({ id }) => id).join("\0").localeCompare(
    candidate.purchases.map(({ id }) => id).join("\0"),
  );
}

function bestSeries<Purchase extends ClusteringPurchase>(
  purchases: readonly Purchase[],
  timeZone: string,
): QualifiedSeries<Purchase> | null {
  if (purchases.length < 3) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
  });
  const ordered = [...purchases].sort(comparePurchases);
  const ordinals = new Map(ordered.map((purchase) => [purchase.id, localOrdinal(purchase.date, formatter)]));
  const seen = new Set<string>();
  let best: QualifiedSeries<Purchase> | null = null;

  for (const window of SEARCH_WINDOWS) {
    for (let anchor = 0; anchor < ordered.length; anchor += 1) {
      const candidatePurchases = extendSeed(ordered, ordinals, anchor, window);
      if (candidatePurchases.length < 3) continue;
      // P4a intentionally accepts three observations. Repeating that test
      // across every seed in a noisy merchant bucket, however, multiplies its
      // false-positive rate. Weak series are accepted when they explain the
      // whole residual bucket; extracting one from unrelated residual traffic
      // requires more independent occurrences.
      if (
        candidatePurchases.length < MIN_SERIES_AMID_NOISE
        && candidatePurchases.length < ordered.length
      ) continue;
      const signature = `${window.type}\0${candidatePurchases.map(({ id }) => id).join("\0")}`;
      if (seen.has(signature)) continue;
      seen.add(signature);

      const cadence = inferCadence(candidatePurchases.map(({ date }) => date), timeZone);
      // inferCadence may find a shorter harmonic inside a candidate generated
      // for another window. Returning the whole generated set in that case
      // would attach observations the inference never matched. Only accept a
      // candidate when P4a confirms the cadence it was generated against.
      if (!cadence || cadence.cadence.type !== window.type) continue;
      const amountPattern = inferAmountPattern(candidatePurchases);
      const qualified = { purchases: candidatePurchases, cadence, amountPattern };
      if (!best || compareSeries(qualified, best) > 0) best = qualified;
    }
  }

  return best;
}

/**
 * Find non-overlapping recurring series within each exact identity bucket.
 * The search is bounded by observations x supported cadence windows; it never
 * enumerates arbitrary subsets.
 */
export function clusterRecurringPurchases<Purchase extends ClusteringPurchase>(
  purchases: readonly Purchase[],
  timeZone: string,
): CandidateCluster<Purchase>[] {
  validatePurchases(purchases, timeZone);

  const groups = new Map<string, Purchase[]>();
  for (const purchase of purchases) {
    const key = identityKey(purchase);
    const group = groups.get(key) ?? [];
    group.push(purchase);
    groups.set(key, group);
  }

  const clusters: CandidateCluster<Purchase>[] = [];
  for (const [, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let remaining = [...group];
    while (remaining.length >= 3) {
      const series = bestSeries(remaining, timeZone);
      if (!series) break;

      const first = series.purchases[0];
      clusters.push({
        userId: first.userId,
        canonicalMerchantId: first.canonicalMerchantId,
        currency: first.currency,
        discriminator: first.discriminator ?? null,
        purchases: series.purchases,
        cadence: series.cadence,
        amountPattern: series.amountPattern,
      });

      const selectedIds = new Set(series.purchases.map(({ id }) => id));
      remaining = remaining.filter(({ id }) => !selectedIds.has(id));
    }
  }

  return clusters;
}
