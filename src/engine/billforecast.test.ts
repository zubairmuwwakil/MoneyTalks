import { describe, expect, it } from "vitest";
import { billOccurrences, forecastMonths, type BillDef } from "./billforecast";

const mortgage: BillDef = {
  id: "b1",
  name: "Fixture Mortgage",
  category: "housing",
  currency: "CAD",
  autopay: true,
  variable: false,
  cadence: { type: "BIWEEKLY", anchor: "2026-01-07" },
  schedule: [{ from: "2020-01-01", amountMinor: 100_000 }],
};

const condo: BillDef = {
  id: "b2",
  name: "Fixture Condo Fees",
  category: "housing",
  currency: "CAD",
  autopay: true,
  variable: false,
  cadence: { type: "MONTHLY", dayOfMonth: 1 },
  schedule: [
    { from: "2020-01-01", to: "2026-07-31", amountMinor: 40_000 },
    { from: "2026-08-01", amountMinor: 42_000 },
  ],
};

const stepped: BillDef = {
  id: "b3",
  name: "Fixture Stream Bundle",
  category: "subscriptions",
  currency: "CAD",
  autopay: true,
  variable: false,
  cadence: { type: "MONTHLY", dayOfMonth: 1 },
  schedule: [
    { from: "2025-09-01", to: "2026-08-31", amountMinor: 1_000 },
    { from: "2026-09-01", amountMinor: 1_500 },
  ],
};

describe("billOccurrences", () => {
  it("pairs each occurrence with its date-resolved amount", () => {
    const occ = billOccurrences(stepped, "2026-08-01", "2026-10-31");
    expect(occ.map((o) => [o.date, o.amountMinor])).toEqual([
      ["2026-08-01", 1_000],
      ["2026-09-01", 1_500],
      ["2026-10-01", 1_500],
    ]);
  });

  it("applies the amount change mid-window (condo increase Aug 2026)", () => {
    const occ = billOccurrences(condo, "2026-07-01", "2026-08-31");
    expect(occ.map((o) => o.amountMinor)).toEqual([40_000, 42_000]);
  });

  it("skips dates with no schedule coverage", () => {
    const late: BillDef = { ...condo, schedule: [{ from: "2026-06-01", amountMinor: 100 }] };
    expect(billOccurrences(late, "2026-05-01", "2026-06-30")).toHaveLength(1);
  });
});

describe("forecastMonths", () => {
  it("computes totals, cumulative, and triple-payment flags across 12 months", () => {
    const forecast = forecastMonths([mortgage, condo], "2026-01", 12);
    expect(forecast).toHaveLength(12);

    const jan = forecast[0];
    // Jan 2026: mortgage 7th + 21st (2 × 1000.00) + condo 1st (400.00) = 2400.00
    expect(jan.month).toBe("2026-01");
    expect(jan.totalMinor).toBe(240_000);
    expect(jan.flags).toEqual([]);

    const apr = forecast[3];
    // Apr 2026: TRIPLE mortgage (1st, 15th, 29th) + condo = 3 × 1000.00 + 400.00 = 3400.00
    expect(apr.totalMinor).toBe(340_000);
    expect(apr.flags).toEqual(["3× Fixture Mortgage"]);

    const sep = forecast[8];
    // Sep 2026: TRIPLE mortgage + condo at the increased rate = 3 × 1000.00 + 420.00 = 3420.00
    expect(sep.totalMinor).toBe(342_000);
    expect(sep.flags).toEqual(["3× Fixture Mortgage"]);

    // Cumulative is a running sum
    expect(forecast[1].cumulativeMinor).toBe(jan.totalMinor + forecast[1].totalMinor);
  });

  it("bounds monthsCount", () => {
    expect(() => forecastMonths([condo], "2026-01", 61)).toThrow(RangeError);
  });
});
