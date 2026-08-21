import { describe, expect, it } from "vitest";
import type { FxRateInput } from "@/engine/fx";
import {
  buildNetWorthHistory,
  selectNetWorthRange,
  summarizeNetWorthRange,
  type NetWorthAccountInput,
  type NetWorthHistoryPoint,
} from "./netWorthHistory";

const TODAY = new Date("2026-08-20T12:00:00.000Z");

function account(
  id: string,
  snapshots: NetWorthAccountInput["snapshots"],
  overrides: Partial<NetWorthAccountInput> = {},
): NetWorthAccountInput {
  return {
    id,
    name: id,
    hasSetupData: true,
    snapshots,
    ...overrides,
  };
}

function snapshot(
  asOf: string,
  totalMinor: number,
  overrides: Partial<NetWorthAccountInput["snapshots"][number]> = {},
): NetWorthAccountInput["snapshots"][number] {
  return {
    asOf,
    capturedAt: `${asOf.slice(0, 10)}T23:59:59.999Z`,
    currency: "CAD",
    totalMinor,
    displayCurrency: "CAD",
    displayTotalMinor: totalMinor,
    status: "COMPLETE",
    ...overrides,
  };
}

describe("buildNetWorthHistory", () => {
  it("excludes a portfolio date when an active account has only a partial valuation", () => {
    const result = buildNetWorthHistory(
      [
        account("Brokerage", [
          snapshot("2026-08-18", 10_000),
          snapshot("2026-08-19", 10_500),
          snapshot("2026-08-20", 11_000, { status: "PARTIAL" }),
        ]),
        account("Savings", [
          snapshot("2026-08-18", 20_000),
          snapshot("2026-08-19", 21_000),
          snapshot("2026-08-20", 22_000),
        ]),
      ],
      "CAD",
      [],
      TODAY,
    );

    expect(result.points).toEqual([
      { date: "2026-08-18", totalMinor: 30_000 },
      { date: "2026-08-19", totalMinor: 31_500 },
    ]);
    expect(result.state).toBe("incomplete");
    expect(result.incompleteAccounts).toEqual(["Brokerage"]);
    expect(result.latestCompleteAsOf).toBe("2026-08-19");
  });

  it("adds an account from its first complete daily valuation without erasing earlier history", () => {
    const result = buildNetWorthHistory(
      [
        account("Original", [
          snapshot("2026-08-18", 10_000),
          snapshot("2026-08-19", 10_500),
          snapshot("2026-08-20", 11_000),
        ]),
        account("New account", [snapshot("2026-08-20", 5_000)]),
      ],
      "CAD",
      [],
      TODAY,
    );

    expect(result.points).toEqual([
      { date: "2026-08-18", totalMinor: 10_000 },
      { date: "2026-08-19", totalMinor: 10_500 },
      { date: "2026-08-20", totalMinor: 16_000 },
    ]);
    expect(result.state).toBe("tracking");
  });

  it("preserves historical totals for an account whose current setup data was removed", () => {
    const result = buildNetWorthHistory(
      [
        account(
          "Archived account",
          [snapshot("2026-08-19", 10_000), snapshot("2026-08-20", 10_500)],
          { hasSetupData: false },
        ),
      ],
      "CAD",
      [],
      TODAY,
    );

    expect(result.points).toEqual([
      { date: "2026-08-19", totalMinor: 10_000 },
      { date: "2026-08-20", totalMinor: 10_500 },
    ]);
  });

  it("prefers stored display evidence when it matches the requested currency", () => {
    const result = buildNetWorthHistory(
      [
        account("USD account", [
          snapshot("2026-08-20", 10_000, {
            currency: "USD",
            displayCurrency: "CAD",
            displayTotalMinor: 13_700,
          }),
        ]),
      ],
      "CAD",
      [],
      TODAY,
    );

    expect(result.points).toEqual([{ date: "2026-08-20", totalMinor: 13_700 }]);
    expect(result.state).toBe("pending");
  });

  it("uses only FX evidence available on or before the valuation date", () => {
    const rates: FxRateInput[] = [
      { base: "USD", quote: "JMD", rate: 150, asOf: "2026-08-17T12:00:00.000Z" },
      { base: "USD", quote: "JMD", rate: 200, asOf: "2026-08-19T12:00:00.000Z" },
    ];
    const result = buildNetWorthHistory(
      [
        account("USD account", [
          snapshot("2026-08-18T02:00:00.000Z", 10_000, {
            currency: "USD",
            displayCurrency: "CAD",
            displayTotalMinor: 13_700,
          }),
        ]),
      ],
      "JMD",
      rates,
      new Date("2026-08-18T12:00:00.000Z"),
    );

    expect(result.points).toEqual([{ date: "2026-08-18", totalMinor: 1_500_000 }]);
  });

  it("does not apply an FX rate published after the snapshot was captured on the same day", () => {
    const rates: FxRateInput[] = [
      { base: "USD", quote: "JMD", rate: 150, asOf: "2026-08-18T01:00:00.000Z" },
      { base: "USD", quote: "JMD", rate: 200, asOf: "2026-08-18T03:00:00.000Z" },
    ];
    const capturedSnapshot = {
      ...snapshot("2026-08-18T00:00:00.000Z", 10_000, {
        currency: "USD",
        displayCurrency: "CAD",
        displayTotalMinor: 13_700,
      }),
      capturedAt: "2026-08-18T02:00:00.000Z",
    };
    const result = buildNetWorthHistory(
      [account("USD account", [capturedSnapshot])],
      "JMD",
      rates,
      new Date("2026-08-18T12:00:00.000Z"),
    );

    expect(result.points).toEqual([{ date: "2026-08-18", totalMinor: 1_500_000 }]);
  });

  it("reports setup accounts without a convertible complete valuation as incomplete", () => {
    const result = buildNetWorthHistory(
      [
        account("USD account", [
          snapshot("2026-08-20", 10_000, {
            currency: "USD",
            displayCurrency: "CAD",
            displayTotalMinor: 13_700,
          }),
        ]),
        account("Empty", [], { hasSetupData: false }),
      ],
      "JMD",
      [],
      TODAY,
    );

    expect(result.points).toEqual([]);
    expect(result.state).toBe("incomplete");
    expect(result.incompleteAccounts).toEqual(["USD account"]);
  });

  it("does not show another account's value as a complete portfolio total after an incomplete account becomes active", () => {
    const result = buildNetWorthHistory(
      [
        account("Tracked", [
          snapshot("2026-08-18", 10_000),
          snapshot("2026-08-19", 10_500),
          snapshot("2026-08-20", 11_000),
        ]),
        account("Broken", [
          snapshot("2026-08-19", 20_000, { status: "PARTIAL" }),
          snapshot("2026-08-20", 21_000, { status: "PARTIAL" }),
        ]),
      ],
      "CAD",
      [],
      TODAY,
    );

    expect(result.points).toEqual([{ date: "2026-08-18", totalMinor: 10_000 }]);
    expect(result.state).toBe("incomplete");
    expect(result.incompleteAccounts).toEqual(["Broken"]);
  });
});

describe("selectNetWorthRange", () => {
  const points: NetWorthHistoryPoint[] = [
    { date: "2025-12-31", totalMinor: 8_000 },
    { date: "2026-01-01", totalMinor: 8_500 },
    { date: "2026-02-27", totalMinor: 9_000 },
    { date: "2026-02-28", totalMinor: 9_500 },
    { date: "2026-03-31", totalMinor: 10_000 },
  ];

  it("uses the exact one-month boundary when the anchor day exceeds February", () => {
    expect(selectNetWorthRange(points, "1M").map((point) => point.date)).toEqual([
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("uses January 1 as the year-to-date boundary when that observation exists", () => {
    expect(selectNetWorthRange(points, "YTD").map((point) => point.date)).toEqual([
      "2026-01-01",
      "2026-02-27",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("falls back to the latest observation before a missing weekly boundary", () => {
    const weekly: NetWorthHistoryPoint[] = [
      { date: "2026-08-12", totalMinor: 10_000 },
      { date: "2026-08-14", totalMinor: 10_200 },
      { date: "2026-08-20", totalMinor: 10_700 },
    ];

    expect(selectNetWorthRange(weekly, "1W")).toEqual(weekly);
  });

  it("does not label an arbitrarily old observation as a one-week baseline", () => {
    const sparse: NetWorthHistoryPoint[] = [
      { date: "2026-07-01", totalMinor: 9_000 },
      { date: "2026-08-14", totalMinor: 10_200 },
      { date: "2026-08-20", totalMinor: 10_700 },
    ];

    expect(selectNetWorthRange(sparse, "1W")).toEqual(sparse.slice(1));
  });
});

describe("summarizeNetWorthRange", () => {
  it("reports raw net-worth change and percent change", () => {
    expect(
      summarizeNetWorthRange([
        { date: "2026-08-13", totalMinor: 10_000 },
        { date: "2026-08-20", totalMinor: 11_500 },
      ]),
    ).toEqual({ changeMinor: 1_500, changePercent: 0.15 });
  });

  it("does not invent a percentage from a zero baseline or a change from one point", () => {
    expect(
      summarizeNetWorthRange([
        { date: "2026-08-13", totalMinor: 0 },
        { date: "2026-08-20", totalMinor: 500 },
      ]),
    ).toEqual({ changeMinor: 500, changePercent: null });
    expect(summarizeNetWorthRange([{ date: "2026-08-20", totalMinor: 500 }])).toEqual({
      changeMinor: null,
      changePercent: null,
    });
  });

  it("does not present a percentage change from a negative net-worth baseline", () => {
    expect(
      summarizeNetWorthRange([
        { date: "2026-08-13", totalMinor: -1_000 },
        { date: "2026-08-20", totalMinor: 500 },
      ]),
    ).toEqual({ changeMinor: 1_500, changePercent: null });
  });
});
