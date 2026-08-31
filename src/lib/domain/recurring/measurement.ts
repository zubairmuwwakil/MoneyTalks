import { parseCsv } from "@/engine/csv";

const DAY_MS = 86_400_000;

export const MERCHANT_LABEL_VALUES = ["yes", "no", "uncertain"] as const;
export const SERIES_LABEL_VALUES = ["yes", "no", "uncertain"] as const;

export type EvaluationLabel = "yes" | "no" | "uncertain" | "";

export interface MeasurementPurchase {
  id: string;
  merchant: string;
  totalCents: number | null;
  currency: string | null;
  purchasedAt: Date;
}

export interface MeasurementReason {
  code: string;
  delta?: number;
}

export interface MeasurementSeries {
  seriesKey: string;
  merchant: string;
  currency: string | null;
  cadence: string;
  confidence: number;
  reasons: MeasurementReason[];
  evidencePurchaseIds: string[];
  evidenceDates: Date[];
}

export interface DecisionSnapshot {
  confirmedAt: Date | null;
  dismissedAt: Date | null;
  dismissReason: string | null;
  decidedConfidence: number | null;
  decidedReasons: unknown;
}

export interface MerchantInventoryRow {
  merchant: string;
  purchaseCount: number;
  firstDate: string;
  lastDate: string;
  dateSpanDays: number;
  medianIntervalDays: number | null;
  intervalMadDays: number | null;
  amountSpread: string;
  reviewScore: number;
}

export interface MerchantEvaluation {
  merchant: string;
  label: EvaluationLabel;
  notes: string;
}

export interface SeriesEvaluation {
  seriesKey: string;
  label: EvaluationLabel;
  notes: string;
}

export interface LabelCoverage {
  complete: boolean;
  labeled: number;
  total: number;
  uncertain: number;
  missing: string[];
}

export interface MerchantConfusion {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number | null;
  recall: number | null;
}

export interface SeriesPrecision {
  truePositives: number;
  falsePositives: number;
  precision: number | null;
}

export interface SignalContribution {
  code: string;
  truePositiveCount: number;
  falsePositiveCount: number;
  truePositiveRate: number | null;
  falsePositiveRate: number | null;
  prevalenceDifference: number | null;
}

export interface DecisionStreamMeasurement {
  confirmed: number;
  detectorDismissals: number;
  preferenceDismissals: number;
  ambiguousDismissals: number;
  precision: number | null;
  scoreCurve: ScoreBucket[] | null;
  scoreCurveSuppressedReason: string | null;
}

export interface ScoreBucket {
  label: string;
  total: number;
  positives: number;
  precision: number;
}

export interface ProportionInterval {
  low: number;
  high: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median requires at least one value");
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function medianAbsoluteDeviation(values: readonly number[]): number {
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

function localDay(date: Date, formatter: Intl.DateTimeFormat): { iso: string; ordinal: number } {
  if (!Number.isFinite(date.getTime())) throw new RangeError("measurement dates must be valid Dates");
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((candidate) => candidate.type === type)?.value);
    if (!Number.isInteger(value)) throw new RangeError(`could not read ${type} from measurement date`);
    return value;
  };
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return {
    iso: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
    ordinal: Math.trunc(Date.UTC(year, month - 1, day) / DAY_MS),
  };
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function amountSpread(purchases: readonly MeasurementPurchase[]): string {
  const byCurrency = new Map<string, number[]>();
  let unpriced = 0;
  for (const purchase of purchases) {
    if (purchase.totalCents === null) {
      unpriced += 1;
      continue;
    }
    const currency = purchase.currency?.trim().toUpperCase() || "currency unknown";
    byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), purchase.totalCents]);
  }
  const priced = [...byCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, values]) => {
      const low = Math.min(...values);
      const high = Math.max(...values);
      return `${currency} ${(low / 100).toFixed(2)}–${(high / 100).toFixed(2)} (Δ${((high - low) / 100).toFixed(2)})`;
    });
  if (unpriced > 0) priced.push(`${unpriced} unpriced`);
  return priced.length > 0 ? priced.join("; ") : "no priced purchases";
}

function recurrenceReviewScore(medianInterval: number | null, intervalMad: number | null, count: number): number {
  if (medianInterval === null || intervalMad === null) return 0;
  const candidates = [
    { period: 7, tolerance: 2 },
    { period: 14, tolerance: 4 },
    { period: 30, tolerance: 4 },
    { period: 91, tolerance: 10 },
    { period: 182, tolerance: 10 },
    { period: 365, tolerance: 10 },
  ];
  const fit = Math.max(...candidates.map(({ period, tolerance }) => {
    const proximity = Math.max(0, 1 - Math.abs(medianInterval - period) / tolerance);
    const regularity = Math.max(0, 1 - intervalMad / tolerance);
    return proximity * regularity;
  }));
  return roundOne(fit * 100 + Math.min(count, 12) / 100);
}

/**
 * Builds the blind merchant pass from raw purchases only. Detector state is
 * intentionally absent so the annotation is not anchored by the prediction.
 */
export function buildMerchantInventory(
  purchases: readonly MeasurementPurchase[],
  timeZone: string,
): MerchantInventoryRow[] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
  });
  const grouped = new Map<string, MeasurementPurchase[]>();
  for (const purchase of purchases) {
    const merchant = purchase.merchant.trim();
    if (!merchant) continue;
    grouped.set(merchant, [...(grouped.get(merchant) ?? []), purchase]);
  }

  return [...grouped.entries()].map(([merchant, merchantPurchases]) => {
    const days = merchantPurchases
      .map(({ purchasedAt }) => localDay(purchasedAt, formatter))
      .sort((left, right) => left.ordinal - right.ordinal);
    const gaps = days.slice(1).map((day, index) => day.ordinal - days[index].ordinal);
    const medianIntervalDays = gaps.length > 0 ? roundOne(median(gaps)) : null;
    const intervalMadDays = gaps.length > 0 ? roundOne(medianAbsoluteDeviation(gaps)) : null;
    return {
      merchant,
      purchaseCount: merchantPurchases.length,
      firstDate: days[0].iso,
      lastDate: days.at(-1)!.iso,
      dateSpanDays: days.at(-1)!.ordinal - days[0].ordinal,
      medianIntervalDays,
      intervalMadDays,
      amountSpread: amountSpread(merchantPurchases),
      reviewScore: recurrenceReviewScore(medianIntervalDays, intervalMadDays, merchantPurchases.length),
    };
  }).sort((left, right) => (
    right.reviewScore - left.reviewScore
    || right.purchaseCount - left.purchaseCount
    || left.merchant.localeCompare(right.merchant)
  ));
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: readonly (readonly (string | number | null)[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

const MERCHANT_HEADERS = [
  "merchant",
  "purchase_count",
  "first_date",
  "last_date",
  "date_span_days",
  "median_interval_days",
  "interval_mad_days",
  "amount_spread",
  "recurring_label",
  "notes",
] as const;

const SERIES_HEADERS = [
  "series_key",
  "merchant",
  "currency",
  "cadence",
  "evidence_count",
  "evidence_dates",
  "amount_spread",
  "confidence",
  "reasons",
  "series_label",
  "notes",
] as const;

function parseEvaluationLabel(value: string, row: number): EvaluationLabel {
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || MERCHANT_LABEL_VALUES.includes(normalized as Exclude<EvaluationLabel, "">)) {
    return normalized as EvaluationLabel;
  }
  throw new RangeError(`row ${row}: label must be yes, no, uncertain, or blank`);
}

function records(text: string, expectedHeaders: readonly string[]): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new RangeError("evaluation CSV is empty");
  const headers = rows[0].map((header) => header.trim());
  if (headers.join("\0") !== expectedHeaders.join("\0")) {
    throw new RangeError(`evaluation CSV headers changed; expected ${expectedHeaders.join(",")}`);
  }
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

export function parseMerchantEvaluations(text: string): MerchantEvaluation[] {
  const seen = new Set<string>();
  return records(text, MERCHANT_HEADERS).map((record, index) => {
    const merchant = record.merchant.trim();
    if (!merchant) throw new RangeError(`row ${index + 2}: merchant is required`);
    if (seen.has(merchant)) throw new RangeError(`row ${index + 2}: duplicate merchant ${merchant}`);
    seen.add(merchant);
    return {
      merchant,
      label: parseEvaluationLabel(record.recurring_label, index + 2),
      notes: record.notes.trim(),
    };
  });
}

export function merchantEvaluationCsv(
  inventory: readonly MerchantInventoryRow[],
  prior: readonly MerchantEvaluation[] = [],
): string {
  const priorByMerchant = new Map(prior.map((evaluation) => [evaluation.merchant, evaluation]));
  return csv([
    MERCHANT_HEADERS,
    ...inventory.map((row) => {
      const evaluation = priorByMerchant.get(row.merchant);
      return [
        row.merchant,
        row.purchaseCount,
        row.firstDate,
        row.lastDate,
        row.dateSpanDays,
        row.medianIntervalDays,
        row.intervalMadDays,
        row.amountSpread,
        evaluation?.label ?? "",
        evaluation?.notes ?? "",
      ];
    }),
  ]);
}

export function seriesEvaluationCsv(
  series: readonly MeasurementSeries[],
  purchases: readonly MeasurementPurchase[],
  prior: readonly SeriesEvaluation[] = [],
): string {
  const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  const priorByKey = new Map(prior.map((evaluation) => [evaluation.seriesKey, evaluation]));
  const rows = [...series].sort((left, right) => (
    left.merchant.localeCompare(right.merchant) || left.seriesKey.localeCompare(right.seriesKey)
  )).map((item) => {
    if (!item.seriesKey) throw new RangeError(`detected series for ${item.merchant} has no stable series key`);
    const evidencePurchases = item.evidencePurchaseIds.flatMap((id) => {
      const purchase = purchaseById.get(id);
      return purchase ? [purchase] : [];
    });
    const evaluation = priorByKey.get(item.seriesKey);
    return [
      item.seriesKey,
      item.merchant,
      item.currency ?? "",
      item.cadence,
      item.evidenceDates.length,
      item.evidenceDates.map((date) => date.toISOString().slice(0, 10)).sort().join(" | "),
      amountSpread(evidencePurchases),
      item.confidence.toFixed(2),
      item.reasons.map(({ code }) => code).join(" | "),
      evaluation?.label ?? "",
      evaluation?.notes ?? "",
    ];
  });
  return csv([SERIES_HEADERS, ...rows]);
}

export function parseSeriesEvaluations(text: string): SeriesEvaluation[] {
  const seen = new Set<string>();
  return records(text, SERIES_HEADERS).map((record, index) => {
    const seriesKey = record.series_key.trim();
    if (!seriesKey) throw new RangeError(`row ${index + 2}: series_key is required`);
    if (seen.has(seriesKey)) throw new RangeError(`row ${index + 2}: duplicate series_key ${seriesKey}`);
    seen.add(seriesKey);
    return {
      seriesKey,
      label: parseEvaluationLabel(record.series_label, index + 2),
      notes: record.notes.trim(),
    };
  });
}

function coverage(keys: readonly string[], evaluations: ReadonlyMap<string, EvaluationLabel>): LabelCoverage {
  const missing = keys.filter((key) => {
    const label = evaluations.get(key);
    return label === undefined || label === "" || label === "uncertain";
  });
  const uncertain = keys.filter((key) => evaluations.get(key) === "uncertain").length;
  return {
    complete: missing.length === 0,
    labeled: keys.length - missing.length,
    total: keys.length,
    uncertain,
    missing,
  };
}

export function merchantLabelCoverage(
  inventory: readonly MerchantInventoryRow[],
  evaluations: readonly MerchantEvaluation[],
): LabelCoverage {
  const byMerchant = new Map(evaluations.map(({ merchant, label }) => [merchant, label]));
  return coverage(inventory.map(({ merchant }) => merchant), byMerchant);
}

export function seriesLabelCoverage(
  series: readonly MeasurementSeries[],
  evaluations: readonly SeriesEvaluation[],
): LabelCoverage {
  const bySeries = new Map(evaluations.map(({ seriesKey, label }) => [seriesKey, label]));
  return coverage(series.map(({ seriesKey }) => seriesKey), bySeries);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** 95% Wilson score interval; unlike Wald, it remains honest at 0/n and n/n. */
export function wilsonInterval(successes: number, total: number): ProportionInterval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < successes) {
    throw new RangeError("Wilson interval requires integer 0 <= successes <= total");
  }
  if (total === 0) return null;
  const z = 1.96;
  const proportion = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const centre = (proportion + zSquared / (2 * total)) / denominator;
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) + zSquared / (4 * total)) / total,
  ) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function measureMerchants(
  inventory: readonly MerchantInventoryRow[],
  evaluations: readonly MerchantEvaluation[],
  detectedSeries: readonly MeasurementSeries[],
): MerchantConfusion | null {
  if (!merchantLabelCoverage(inventory, evaluations).complete) return null;
  const labels = new Map(evaluations.map(({ merchant, label }) => [merchant, label]));
  const detected = new Set(detectedSeries.map(({ merchant }) => merchant));
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  for (const { merchant } of inventory) {
    const actual = labels.get(merchant) === "yes";
    const predicted = detected.has(merchant);
    if (actual && predicted) truePositives += 1;
    else if (!actual && predicted) falsePositives += 1;
    else if (actual) falseNegatives += 1;
    else trueNegatives += 1;
  }
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
  };
}

export function measureSeriesPrecision(
  series: readonly MeasurementSeries[],
  evaluations: readonly SeriesEvaluation[],
): SeriesPrecision | null {
  if (!seriesLabelCoverage(series, evaluations).complete) return null;
  const labels = new Map(evaluations.map(({ seriesKey, label }) => [seriesKey, label]));
  const truePositives = series.filter(({ seriesKey }) => labels.get(seriesKey) === "yes").length;
  const falsePositives = series.filter(({ seriesKey }) => labels.get(seriesKey) === "no").length;
  return {
    truePositives,
    falsePositives,
    precision: ratio(truePositives, truePositives + falsePositives),
  };
}

export function measureSignalContribution(
  series: readonly MeasurementSeries[],
  evaluations: readonly SeriesEvaluation[],
): SignalContribution[] | null {
  if (!seriesLabelCoverage(series, evaluations).complete) return null;
  const labels = new Map(evaluations.map(({ seriesKey, label }) => [seriesKey, label]));
  const positives = series.filter(({ seriesKey }) => labels.get(seriesKey) === "yes");
  const negatives = series.filter(({ seriesKey }) => labels.get(seriesKey) === "no");
  const codes = [...new Set(series.flatMap(({ reasons }) => reasons.map(({ code }) => code)))].sort();
  return codes.map((code) => {
    const truePositiveCount = positives.filter(({ reasons }) => reasons.some((reason) => reason.code === code)).length;
    const falsePositiveCount = negatives.filter(({ reasons }) => reasons.some((reason) => reason.code === code)).length;
    const truePositiveRate = ratio(truePositiveCount, positives.length);
    const falsePositiveRate = ratio(falsePositiveCount, negatives.length);
    return {
      code,
      truePositiveCount,
      falsePositiveCount,
      truePositiveRate,
      falsePositiveRate,
      prevalenceDifference: truePositiveRate === null || falsePositiveRate === null
        ? null
        : truePositiveRate - falsePositiveRate,
    };
  });
}

function scoreBuckets(labels: readonly { positive: boolean; score: number }[]): ScoreBucket[] {
  const buckets = new Map<number, { total: number; positives: number }>();
  for (const label of labels) {
    const index = Math.min(9, Math.max(0, Math.floor(label.score * 10)));
    const current = buckets.get(index) ?? { total: 0, positives: 0 };
    current.total += 1;
    current.positives += Number(label.positive);
    buckets.set(index, current);
  }
  return [...buckets.entries()].sort(([left], [right]) => left - right).map(([index, bucket]) => ({
    label: `${(index / 10).toFixed(1)}–${((index + 1) / 10).toFixed(1)}`,
    total: bucket.total,
    positives: bucket.positives,
    precision: bucket.positives / bucket.total,
  }));
}

/** Decision labels can measure precision only; they contain no undetected rows. */
export function measureDecisionStream(decisions: readonly DecisionSnapshot[]): DecisionStreamMeasurement {
  const evaluable: Array<{ positive: boolean; score: number }> = [];
  let confirmed = 0;
  let detectorDismissals = 0;
  let preferenceDismissals = 0;
  let ambiguousDismissals = 0;

  for (const decision of decisions) {
    if (decision.confirmedAt) {
      confirmed += 1;
      if (decision.decidedConfidence !== null) {
        evaluable.push({ positive: true, score: decision.decidedConfidence });
      }
      continue;
    }
    if (!decision.dismissedAt) continue;
    if (decision.dismissReason === "not-recurring" || decision.dismissReason === "duplicate") {
      detectorDismissals += 1;
      if (decision.decidedConfidence !== null) {
        evaluable.push({ positive: false, score: decision.decidedConfidence });
      }
    } else if (decision.dismissReason === "not-interested") {
      preferenceDismissals += 1;
    } else {
      ambiguousDismissals += 1;
    }
  }

  const buckets = scoreBuckets(evaluable);
  const enoughForCurve = evaluable.length >= 30 && buckets.length >= 4;
  return {
    confirmed,
    detectorDismissals,
    preferenceDismissals,
    ambiguousDismissals,
    precision: ratio(confirmed, confirmed + detectorDismissals),
    scoreCurve: enoughForCurve ? buckets : null,
    scoreCurveSuppressedReason: enoughForCurve
      ? null
      : `suppressed: ${evaluable.length} evaluable decision(s) across ${buckets.length} occupied score bucket(s); require at least 30 and 4`,
  };
}

export function reasonCodes(value: unknown): MeasurementReason[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null || !("code" in candidate)) return [];
    const code = candidate.code;
    if (typeof code !== "string" || !code.trim()) return [];
    const delta = "delta" in candidate && typeof candidate.delta === "number" ? candidate.delta : undefined;
    return [{ code: code.trim(), ...(delta === undefined ? {} : { delta }) }];
  });
}
