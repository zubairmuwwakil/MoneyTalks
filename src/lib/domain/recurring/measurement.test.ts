import { describe, expect, it } from "vitest";

import {
  buildMerchantInventory,
  measureDecisionStream,
  measureMerchants,
  measureSeriesPrecision,
  measureSignalContribution,
  merchantEvaluationCsv,
  merchantLabelCoverage,
  parseMerchantEvaluations,
  parseSeriesEvaluations,
  reasonCodes,
  seriesEvaluationCsv,
  seriesLabelCoverage,
  wilsonInterval,
  type MeasurementPurchase,
  type MeasurementSeries,
} from "./measurement";

function purchase(
  id: string,
  merchant: string,
  date: string,
  totalCents: number | null = 1_000,
  currency: string | null = "CAD",
): MeasurementPurchase {
  return { id, merchant, purchasedAt: new Date(`${date}T16:00:00.000Z`), totalCents, currency };
}

const detectedSeries: MeasurementSeries[] = [
  {
    seriesKey: "anthropic-monthly",
    merchant: "anthropic.com",
    currency: "USD",
    cadence: "MONTHLY",
    confidence: 0.35,
    reasons: [{ code: "REGULAR_OCCURRENCES", delta: 0.35 }],
    evidencePurchaseIds: ["a1", "a2", "a3"],
    evidenceDates: [new Date("2026-02-13T12:00:00Z"), new Date("2026-03-13T12:00:00Z")],
  },
  {
    seriesKey: "anthropic-biweekly",
    merchant: "anthropic.com",
    currency: "USD",
    cadence: "BIWEEKLY",
    confidence: 0.5,
    reasons: [{ code: "REGULAR_OCCURRENCES" }, { code: "MANY_OCCURRENCES" }],
    evidencePurchaseIds: ["a4", "a5", "a6"],
    evidenceDates: [new Date("2026-02-24T12:00:00Z"), new Date("2026-03-09T12:00:00Z")],
  },
];

describe("buildMerchantInventory", () => {
  it("reports local-calendar intervals, MAD, amount spread, and review ordering", () => {
    const rows = buildMerchantInventory([
      purchase("f1", "Freedom Mobile", "2026-01-01", 5_000),
      purchase("f2", "Freedom Mobile", "2026-01-31", 5_000),
      purchase("p1", "PRESTO", "2026-01-01", 2_000),
      purchase("p2", "PRESTO", "2026-01-11", 1_000),
      purchase("p3", "PRESTO", "2026-01-22", 3_000),
      purchase("p4", "PRESTO", "2026-02-03", 2_500),
      purchase("p5", "PRESTO", "2026-02-20", 4_000),
    ], "America/Toronto");

    expect(rows[0]).toMatchObject({
      merchant: "Freedom Mobile",
      purchaseCount: 2,
      dateSpanDays: 30,
      medianIntervalDays: 30,
      intervalMadDays: 0,
      amountSpread: "CAD 50.00–50.00 (Δ0.00)",
    });
    expect(rows[0].reviewScore).toBeGreaterThan(rows[1].reviewScore);
    expect(rows[1]).toMatchObject({ merchant: "PRESTO", medianIntervalDays: 11.5, intervalMadDays: 1 });
  });

  it("keeps currencies separate and reports unpriced observations", () => {
    const [row] = buildMerchantInventory([
      purchase("a", "merchant", "2026-01-01", 500, "USD"),
      purchase("b", "merchant", "2026-02-01", 700, "USD"),
      purchase("c", "merchant", "2026-03-01", 900, "CAD"),
      purchase("d", "merchant", "2026-04-01", null, null),
    ], "UTC");
    expect(row.amountSpread).toBe("CAD 9.00–9.00 (Δ0.00); USD 5.00–7.00 (Δ2.00); 1 unpriced");
  });
});

describe("evaluation CSVs", () => {
  it("keeps the merchant pass blind and preserves prior labels", () => {
    const inventory = buildMerchantInventory([
      purchase("a1", "anthropic.com", "2026-01-01", 1_089, "USD"),
      purchase("a2", "anthropic.com", "2026-02-01", 1_089, "USD"),
    ], "UTC");
    const text = merchantEvaluationCsv(inventory, [{
      merchant: "anthropic.com",
      label: "yes",
      notes: "10.89, 31.64 and 113 are subscriptions; API credits are not",
    }]);

    expect(text).not.toContain("detected");
    expect(text).not.toContain("confidence");
    expect(parseMerchantEvaluations(text)).toEqual([{
      merchant: "anthropic.com",
      label: "yes",
      notes: "10.89, 31.64 and 113 are subscriptions; API credits are not",
    }]);
  });

  it("rejects unknown labels and duplicate identities", () => {
    const inventory = buildMerchantInventory([purchase("a1", "anthropic.com", "2026-01-01")], "UTC");
    const text = merchantEvaluationCsv(inventory).replace(",,\n", ",maybe,\n");
    expect(() => parseMerchantEvaluations(text)).toThrow("label must be yes, no, uncertain, or blank");

    const duplicate = `${merchantEvaluationCsv(inventory)}${merchantEvaluationCsv(inventory).split("\n")[1]}\n`;
    expect(() => parseMerchantEvaluations(duplicate)).toThrow("duplicate merchant anthropic.com");
  });

  it("renders and parses stable detected-series labels", () => {
    const text = seriesEvaluationCsv(detectedSeries, [
      purchase("a1", "anthropic.com", "2026-02-13", 1_089, "USD"),
      purchase("a2", "anthropic.com", "2026-03-13", 1_089, "USD"),
      purchase("a3", "anthropic.com", "2026-04-13", 2_178, "USD"),
    ], [{ seriesKey: "anthropic-monthly", label: "yes", notes: "genuine subscription" }]);

    expect(text).toContain("REGULAR_OCCURRENCES | MANY_OCCURRENCES");
    expect(parseSeriesEvaluations(text)).toEqual([
      { seriesKey: "anthropic-biweekly", label: "", notes: "" },
      { seriesKey: "anthropic-monthly", label: "yes", notes: "genuine subscription" },
    ]);
  });
});

describe("ground-truth measurements", () => {
  const inventory = buildMerchantInventory([
    purchase("a1", "anthropic.com", "2026-01-01"),
    purchase("a2", "anthropic.com", "2026-02-01"),
    purchase("f1", "Freedom Mobile", "2026-01-01"),
    purchase("f2", "Freedom Mobile", "2026-01-31"),
    purchase("p1", "PRESTO", "2026-01-01"),
    purchase("p2", "PRESTO", "2026-01-10"),
  ], "UTC");

  it("refuses merchant metrics until every merchant has a yes/no label", () => {
    const partial = [{ merchant: "anthropic.com", label: "yes" as const, notes: "" }];
    expect(merchantLabelCoverage(inventory, partial)).toMatchObject({ complete: false, labeled: 1, total: 3 });
    expect(measureMerchants(inventory, partial, detectedSeries)).toBeNull();
  });

  it("separates merchant-level recall from series precision", () => {
    const merchantLabels = [
      { merchant: "anthropic.com", label: "yes" as const, notes: "" },
      { merchant: "Freedom Mobile", label: "yes" as const, notes: "" },
      { merchant: "PRESTO", label: "no" as const, notes: "" },
    ];
    expect(measureMerchants(inventory, merchantLabels, detectedSeries)).toEqual({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 1,
      trueNegatives: 1,
      precision: 1,
      recall: 0.5,
    });

    const seriesLabels = [
      { seriesKey: "anthropic-monthly", label: "yes" as const, notes: "" },
      { seriesKey: "anthropic-biweekly", label: "no" as const, notes: "API credits" },
    ];
    expect(seriesLabelCoverage(detectedSeries, seriesLabels)).toMatchObject({ complete: true, labeled: 2 });
    expect(measureSeriesPrecision(detectedSeries, seriesLabels)).toEqual({
      truePositives: 1,
      falsePositives: 1,
      precision: 0.5,
    });
  });

  it("reports each reason's prevalence in true and false detected series", () => {
    const result = measureSignalContribution(detectedSeries, [
      { seriesKey: "anthropic-monthly", label: "yes", notes: "" },
      { seriesKey: "anthropic-biweekly", label: "no", notes: "" },
    ]);
    expect(result).toEqual([
      {
        code: "MANY_OCCURRENCES",
        truePositiveCount: 0,
        falsePositiveCount: 1,
        truePositiveRate: 0,
        falsePositiveRate: 1,
        prevalenceDifference: -1,
      },
      {
        code: "REGULAR_OCCURRENCES",
        truePositiveCount: 1,
        falsePositiveCount: 1,
        truePositiveRate: 1,
        falsePositiveRate: 1,
        prevalenceDifference: 0,
      },
    ]);
  });
});

describe("decision-stream measurement", () => {
  it("is precision-only, excludes preference dismissals, and suppresses tiny score curves", () => {
    const at = new Date("2026-08-30T00:00:00Z");
    const result = measureDecisionStream([
      { confirmedAt: at, dismissedAt: null, dismissReason: null, decidedConfidence: 0.8, decidedReasons: [] },
      { confirmedAt: null, dismissedAt: at, dismissReason: "not-recurring", decidedConfidence: 0.5, decidedReasons: [] },
      { confirmedAt: null, dismissedAt: at, dismissReason: "duplicate", decidedConfidence: 0.4, decidedReasons: [] },
      { confirmedAt: null, dismissedAt: at, dismissReason: "not-interested", decidedConfidence: 0.9, decidedReasons: [] },
      { confirmedAt: null, dismissedAt: at, dismissReason: "other: wrong account", decidedConfidence: 0.7, decidedReasons: [] },
    ]);
    expect(result).toMatchObject({
      confirmed: 1,
      detectorDismissals: 2,
      preferenceDismissals: 1,
      ambiguousDismissals: 1,
      precision: 1 / 3,
      scoreCurve: null,
    });
    expect(result.scoreCurveSuppressedReason).toContain("3 evaluable decision(s)");
  });
});

describe("reasonCodes", () => {
  it("fails closed around malformed JSON without hiding valid unknown codes", () => {
    expect(reasonCodes([{ code: "REGULAR_OCCURRENCES", delta: 0.35 }, null, { nope: true }, { code: "FUTURE_SIGNAL" }]))
      .toEqual([{ code: "REGULAR_OCCURRENCES", delta: 0.35 }, { code: "FUTURE_SIGNAL" }]);
  });
});

describe("wilsonInterval", () => {
  it("shows uncertainty even when every observed label is positive", () => {
    expect(wilsonInterval(3, 3)).toEqual({
      low: expect.closeTo(0.4385, 4),
      high: 1,
    });
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(() => wilsonInterval(2, 1)).toThrow("0 <= successes <= total");
  });
});
