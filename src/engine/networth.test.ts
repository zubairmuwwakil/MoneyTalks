import { describe, expect, it } from "vitest";
import type { FxRateInput } from "./fx";
import { netWorth, netWorthSeries, type AccountBalanceRow, type SnapshotRow } from "./networth";

const rates: FxRateInput[] = [{ base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }];

describe("netWorth", () => {
  const rows: AccountBalanceRow[] = [
    { id: "a1", name: "Maple RRSP", type: "RRSP", currency: "CAD", balanceMinor: 500_000 },
    { id: "a2", name: "Eagle Roth", type: "ROTH_IRA", currency: "USD", balanceMinor: 100_000 },
  ];

  it("converts every account into the display currency and totals", () => {
    const result = netWorth(rows, "CAD", rates);
    expect(result.totalMinor).toBe(640_000); // 500000 + 100000*1.4
    expect(result.perAccount[0].displayMinor).toBe(500_000);
    expect(result.perAccount[1].displayMinor).toBe(140_000);
  });

  it("works in the other direction via inverse", () => {
    const result = netWorth(rows, "USD", rates);
    expect(result.totalMinor).toBe(457_143); // round(500000/1.4)=357143 + 100000
  });

  it("handles an empty account list", () => {
    expect(netWorth([], "CAD", rates).totalMinor).toBe(0);
  });
});

describe("netWorthSeries", () => {
  const snaps: SnapshotRow[] = [
    { accountId: "a1", balanceMinor: 100_000, currency: "CAD", asOf: "2026-08-01" },
    { accountId: "a1", balanceMinor: 120_000, currency: "CAD", asOf: "2026-08-03" },
    { accountId: "a2", balanceMinor: 50_000, currency: "USD", asOf: "2026-08-02" },
  ];

  it("forward-fills each account and sums per day", () => {
    const series = netWorthSeries(snaps, "CAD", rates, "2026-08-01", "2026-08-04");
    expect(series).toEqual([
      { date: "2026-08-01", totalMinor: 100_000 }, // a1 only
      { date: "2026-08-02", totalMinor: 170_000 }, // a1 100000 + a2 50000*1.4
      { date: "2026-08-03", totalMinor: 190_000 }, // a1 updated to 120000
      { date: "2026-08-04", totalMinor: 190_000 }, // forward-filled
    ]);
  });

  it("returns an empty array when fromDate is after toDate", () => {
    expect(netWorthSeries(snaps, "CAD", rates, "2026-08-05", "2026-08-01")).toEqual([]);
  });
});
