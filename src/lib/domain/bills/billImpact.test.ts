import { describe, expect, it } from "vitest";
import type { FxRateInput } from "@/engine/fx";
import type { BillDef } from "@/engine/billforecast";
import { buildBillImpact } from "./billImpact";

function bill(overrides: Partial<BillDef> & Pick<BillDef, "id" | "name">): BillDef {
  return {
    id: overrides.id,
    name: overrides.name,
    category: overrides.category ?? "utilities",
    currency: overrides.currency ?? "CAD",
    autopay: overrides.autopay ?? true,
    variable: overrides.variable ?? false,
    cadence: overrides.cadence ?? { type: "MONTHLY", dayOfMonth: 17 },
    schedule: overrides.schedule ?? [{ from: "2026-01-01", amountMinor: 10_000 }],
  };
}

const rates: FxRateInput[] = [
  { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-16" },
];

describe("buildBillImpact", () => {
  it("splits fixed and estimated variable obligations into Monday-aligned weeks", () => {
    const view = buildBillImpact(
      [
        bill({ id: "fixed", name: "Fixed", cadence: { type: "MONTHLY", dayOfMonth: 17 } }),
        bill({
          id: "variable",
          name: "Variable",
          variable: true,
          cadence: { type: "MONTHLY", dayOfMonth: 18 },
          schedule: [{ from: "2026-01-01", amountMinor: 5_000 }],
        }),
        bill({
          id: "later",
          name: "Later",
          cadence: { type: "ANNUAL", anchor: "2026-08-25" },
          schedule: [{ from: "2026-01-01", amountMinor: 20_000 }],
        }),
      ],
      rates,
      "2026-08-17",
      8,
    );

    expect(view.weeks).toHaveLength(8);
    expect(view.weeks[0]).toMatchObject({
      weekStart: "2026-08-17",
      fixedMinor: 10_000,
      variableMinor: 5_000,
      totalMinor: 15_000,
      occurrenceCount: 2,
    });
    // The eight calendar-week window also includes the September monthly pair.
    expect(view).toMatchObject({ totalMinor: 50_000, averageMinor: 6_250 });
    expect(view.busiestWeek).toMatchObject({ weekStart: "2026-08-24", totalMinor: 20_000 });
  });

  it("converts foreign bills to CAD and discloses missing FX occurrences", () => {
    const view = buildBillImpact(
      [
        bill({
          id: "usd",
          name: "USD bill",
          currency: "USD",
          schedule: [{ from: "2026-01-01", amountMinor: 10_000 }],
        }),
        bill({
          id: "eur",
          name: "Unknown FX",
          currency: "EUR",
          cadence: { type: "MONTHLY", dayOfMonth: 18 },
        }),
      ],
      rates,
      "2026-08-17",
      8,
    );

    expect(view.totalMinor).toBe(28_000);
    expect(view.excludedCount).toBe(2);
    expect(view).toMatchObject({
      fxOldestAsOf: "2026-08-16",
      fxLatestAsOf: "2026-08-16",
    });
  });

  it("does not include occurrences before the requested start date in the first partial week", () => {
    const view = buildBillImpact(
      [bill({ id: "past", name: "Past this week", cadence: { type: "ANNUAL", anchor: "2026-08-17" } })],
      [],
      "2026-08-20",
      8,
    );

    expect(view.totalMinor).toBe(0);
    expect(view.weeks[0].weekStart).toBe("2026-08-17");
  });

  it("rejects an unbounded runway request", () => {
    expect(() => buildBillImpact([], [], "2026-08-17", 0)).toThrow(RangeError);
    expect(() => buildBillImpact([], [], "2026-08-17", 53)).toThrow(RangeError);
  });

  it("reports the date of an FX rate that the view actually used", () => {
    const view = buildBillImpact(
      [
        bill({
          id: "usd",
          name: "USD bill",
          currency: "USD",
          schedule: [{ from: "2026-01-01", amountMinor: 10_000 }],
        }),
      ],
      [
        { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-12" },
        { base: "JMD", quote: "CAD", rate: 0.009, asOf: "2026-08-19" },
      ],
      "2026-08-17",
      8,
    );

    expect(view).toMatchObject({
      fxOldestAsOf: "2026-08-12",
      fxLatestAsOf: "2026-08-12",
    });
  });

  it("reports the full date range when differently dated FX rates were used", () => {
    const view = buildBillImpact(
      [
        bill({ id: "usd", name: "USD bill", currency: "USD" }),
        bill({ id: "jmd", name: "JMD bill", currency: "JMD", cadence: { type: "MONTHLY", dayOfMonth: 18 } }),
      ],
      [
        { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-01-12" },
        { base: "JMD", quote: "CAD", rate: 0.009, asOf: "2026-08-19" },
      ],
      "2026-08-17",
      8,
    );

    expect(view).toMatchObject({
      fxOldestAsOf: "2026-01-12",
      fxLatestAsOf: "2026-08-19",
    });
  });
});
