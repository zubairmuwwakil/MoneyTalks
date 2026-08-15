import { describe, expect, it } from "vitest";
import { dangerMonths, incomeEvents, projectDailyBalance, type CashEvent } from "./dangermonth";

describe("projectDailyBalance", () => {
  it("applies events on their dates and carries the balance forward", () => {
    const events: CashEvent[] = [
      { date: "2026-01-05", amountMinor: -60_000, label: "Fixture Bill" },
      { date: "2026-01-10", amountMinor: 100_000, label: "Fixture Pay" },
    ];
    const series = projectDailyBalance(50_000, events, "2026-01-01", "2026-01-12");
    expect(series[0]).toEqual({ date: "2026-01-01", balanceMinor: 50_000 });
    expect(series[4]).toEqual({ date: "2026-01-05", balanceMinor: -10_000 });
    expect(series[9]).toEqual({ date: "2026-01-10", balanceMinor: 90_000 });
    expect(series[11]).toEqual({ date: "2026-01-12", balanceMinor: 90_000 });
  });
});

describe("dangerMonths", () => {
  it("flags months whose minimum dips below the cushion, with the dip date", () => {
    const series = [
      { date: "2026-01-05", balanceMinor: 40_000 },
      { date: "2026-01-20", balanceMinor: 90_000 },
      { date: "2026-02-10", balanceMinor: 120_000 },
    ];
    const result = dangerMonths(series, 50_000);
    expect(result).toEqual([{ month: "2026-01", minBalanceMinor: 40_000, minDate: "2026-01-05" }]);
  });

  it("still reports negative balances even with a zero cushion", () => {
    expect(dangerMonths([{ date: "2026-01-05", balanceMinor: -1 }], 0)).toEqual([
      { month: "2026-01", minBalanceMinor: -1, minDate: "2026-01-05" },
    ]);
  });
});

describe("incomeEvents", () => {
  it("expands monthly on the 1st and biweekly every 14 days", () => {
    const events = incomeEvents(
      [
        { name: "Fixture Salary", amountMinor: 200_000, cadence: "MONTHLY", kind: "EMPLOYMENT" },
        { name: "Fixture Gig", amountMinor: 50_000, cadence: "BIWEEKLY", kind: "SELF_EMPLOYMENT" },
      ],
      "2026-01-01",
      "2026-02-28",
    );
    const monthly = events.filter((e) => e.label === "Fixture Salary");
    const biweekly = events.filter((e) => e.label === "Fixture Gig");
    expect(monthly.map((e) => e.date)).toEqual(["2026-01-01", "2026-02-01"]);
    expect(biweekly).toHaveLength(5); // Jan 1, 15, 29, Feb 12, 26
  });
});
