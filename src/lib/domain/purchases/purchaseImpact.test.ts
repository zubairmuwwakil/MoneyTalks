import { describe, expect, it } from "vitest";
import type { FxRateInput } from "@/engine/fx";
import { buildPurchaseImpact } from "./purchaseImpact";

const rates: FxRateInput[] = [
  { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-19" },
];

describe("buildPurchaseImpact", () => {
  it("compares like-for-like weekly ranges after converting amounts to CAD", () => {
    const view = buildPurchaseImpact(
      [
        { date: "2026-08-18", merchant: "North Shop", totalMinor: 10_000, currency: "CAD", refundMinor: 2_000 },
        { date: "2026-08-10", merchant: "South Shop", totalMinor: 10_000, currency: "USD" },
        { date: "2026-08-03", merchant: "North Shop", totalMinor: 16_000, currency: "CAD" },
        { date: "2026-07-20", merchant: "Earlier Shop", totalMinor: 20_000, currency: "CAD" },
      ],
      rates,
      "2026-08-20",
    );

    const range = view.ranges["4W"];
    expect(range.points).toHaveLength(4);
    expect(range).toMatchObject({
      totalMinor: 40_000,
      refundMinor: 2_000,
      netMinor: 38_000,
      previousMinor: 20_000,
      deltaPct: 100,
    });
    expect(range.drivers).toEqual([
      { merchant: "North Shop", amountMinor: 26_000 },
      { merchant: "South Shop", amountMinor: 14_000 },
    ]);
  });

  it("excludes unknown amounts and currencies instead of inventing CAD totals", () => {
    const view = buildPurchaseImpact(
      [
        { date: "2026-08-18", merchant: "Known", totalMinor: 5_000, currency: "CAD" },
        { date: "2026-08-17", merchant: "Unknown FX", totalMinor: 5_000, currency: "EUR" },
        { date: "2026-08-16", merchant: "Missing amount", totalMinor: null, currency: "CAD" },
        { date: "2026-07-20", merchant: "Prior", totalMinor: 10_000, currency: "CAD" },
      ],
      rates,
      "2026-08-20",
    );

    expect(view.ranges["4W"]).toMatchObject({
      totalMinor: 5_000,
      excludedCount: 1,
      missingAmountCount: 1,
      deltaPct: null,
    });
  });

  it("returns a null comparison when the previous period has no tracked value", () => {
    const view = buildPurchaseImpact(
      [{ date: "2026-08-18", merchant: "Only Shop", totalMinor: 5_000, currency: "CAD" }],
      [],
      "2026-08-20",
    );

    expect(view.ranges["4W"].previousMinor).toBe(0);
    expect(view.ranges["4W"].deltaPct).toBeNull();
  });

  it("counts a received refund once without reducing gross merchant drivers", () => {
    const view = buildPurchaseImpact(
      [
        {
          date: "2026-08-18",
          merchant: "Return Shop",
          totalMinor: 10_000,
          currency: "CAD",
          refundMinor: 10_000,
        },
      ],
      [],
      "2026-08-20",
    );

    expect(view.ranges["4W"]).toMatchObject({
      totalMinor: 10_000,
      refundMinor: 10_000,
      netMinor: 0,
    });
    expect(view.ranges["4W"].drivers).toEqual([{ merchant: "Return Shop", amountMinor: 10_000 }]);
  });

  it("places multiple received refunds in the weeks they arrived", () => {
    const view = buildPurchaseImpact(
      [
        {
          date: "2026-08-01",
          merchant: "Split Return Shop",
          totalMinor: 20_000,
          currency: "CAD",
          refunds: [
            { date: "2026-08-11", amountMinor: 4_000, currency: "CAD" },
            { date: "2026-08-18", amountMinor: 6_000, currency: "CAD" },
          ],
        },
      ],
      [],
      "2026-08-20",
    );

    expect(view.ranges["4W"].refundMinor).toBe(10_000);
    expect(view.ranges["4W"].points.map((point) => point.refundMinor)).toEqual([0, 0, 4_000, 6_000]);
  });

  it("withholds the comparison when prior-period amounts are incomplete", () => {
    const view = buildPurchaseImpact(
      [
        { date: "2026-08-18", merchant: "Current Shop", totalMinor: 5_000, currency: "CAD" },
        { date: "2026-07-20", merchant: "Prior Unknown FX", totalMinor: 10_000, currency: "EUR" },
        { date: "2026-07-19", merchant: "Prior Missing Amount", totalMinor: null, currency: "CAD" },
      ],
      rates,
      "2026-08-20",
    );

    expect(view.ranges["4W"]).toMatchObject({
      previousMinor: 0,
      comparisonExcludedCount: 1,
      comparisonMissingAmountCount: 1,
      deltaPct: null,
    });
  });

  it("does not include future-dated activity later in the current week", () => {
    const view = buildPurchaseImpact(
      [
        { date: "2026-08-20", merchant: "Today", totalMinor: 5_000, currency: "CAD" },
        { date: "2026-08-23", merchant: "Future", totalMinor: 9_000, currency: "CAD" },
      ],
      [],
      "2026-08-20",
    );

    expect(view.ranges["4W"].totalMinor).toBe(5_000);
    expect(view.ranges["4W"].drivers).toEqual([{ merchant: "Today", amountMinor: 5_000 }]);
  });

  it("reports the date of an FX rate that the view actually used", () => {
    const view = buildPurchaseImpact(
      [{ date: "2026-08-18", merchant: "USD Shop", totalMinor: 5_000, currency: "USD" }],
      [
        { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-12" },
        { base: "JMD", quote: "CAD", rate: 0.009, asOf: "2026-08-19" },
      ],
      "2026-08-20",
    );

    expect(view.ranges["4W"]).toMatchObject({
      fxOldestAsOf: "2026-08-12",
      fxLatestAsOf: "2026-08-12",
    });
  });

  it("reports the full date range when differently dated FX rates were used", () => {
    const view = buildPurchaseImpact(
      [
        { date: "2026-08-18", merchant: "USD Shop", totalMinor: 5_000, currency: "USD" },
        { date: "2026-08-17", merchant: "JMD Shop", totalMinor: 5_000, currency: "JMD" },
      ],
      [
        { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-01-12" },
        { base: "JMD", quote: "CAD", rate: 0.009, asOf: "2026-08-19" },
      ],
      "2026-08-20",
    );

    expect(view.ranges["4W"]).toMatchObject({
      fxOldestAsOf: "2026-01-12",
      fxLatestAsOf: "2026-08-19",
    });
  });
});
