import { describe, expect, it } from "vitest";
import {
  accountBalance,
  accountBalanceWithCurrency,
  deriveBalanceMinor,
  holdingValueMinor,
  latestSnapshot,
  type SnapshotInput,
  type TxInput,
} from "./balance";

const txs: TxInput[] = [
  { type: "CONTRIBUTION", amountMinor: 100_000, date: "2026-01-10" },
  { type: "DIVIDEND", amountMinor: 5_000, date: "2026-02-01" },
  { type: "INTEREST", amountMinor: 1_000, date: "2026-02-15" },
  { type: "WITHDRAWAL", amountMinor: 20_000, date: "2026-03-01" },
  { type: "FEE", amountMinor: 500, date: "2026-03-02" },
  { type: "BUY", amountMinor: 50_000, date: "2026-03-10" }, // no balance effect
  { type: "SELL", amountMinor: 10_000, date: "2026-03-20" }, // no balance effect
];

describe("deriveBalanceMinor", () => {
  it("applies sign conventions", () => {
    expect(deriveBalanceMinor(txs)).toBe(85_500); // 100000+5000+1000-20000-500
  });

  it("is zero with no transactions", () => {
    expect(deriveBalanceMinor([])).toBe(0);
  });

  it("rejects an unsafe aggregate balance", () => {
    expect(
      () =>
        deriveBalanceMinor([
          { type: "CONTRIBUTION", amountMinor: Number.MAX_SAFE_INTEGER, date: "2026-01-01" },
          { type: "CONTRIBUTION", amountMinor: 1, date: "2026-01-02" },
        ]),
    ).toThrow(RangeError);
  });
});

describe("accountBalance", () => {
  const snaps: SnapshotInput[] = [
    { balanceMinor: 90_000, asOf: "2026-02-20" },
    { balanceMinor: 95_000, asOf: "2026-03-15" },
  ];

  it("prefers the latest snapshot when snapshots exist", () => {
    expect(accountBalance(txs, snaps)).toEqual({
      balanceMinor: 95_000,
      asOf: "2026-03-15",
      source: "snapshot",
    });
  });

  it("derives from transactions when there are no snapshots", () => {
    expect(accountBalance(txs, [])).toEqual({
      balanceMinor: 85_500,
      asOf: "2026-03-20",
      source: "derived",
    });
  });

  it("returns zero derived balance with no data at all", () => {
    expect(accountBalance([], [])).toEqual({
      balanceMinor: 0,
      asOf: null,
      source: "derived",
    });
  });

  it("rejects a snapshot with a non-integer balance", () => {
    expect(() => accountBalance([], [{ balanceMinor: 1.5, asOf: "2026-03-15" }])).toThrow(RangeError);
  });
});

describe("latestSnapshot", () => {
  it("returns the complete latest row so stored currency is preserved", () => {
    const snapshots = [
      { balanceMinor: 90_000, currency: "CAD", asOf: "2026-02-20" },
      { balanceMinor: 95_000, currency: "USD", asOf: "2026-03-15" },
    ];

    expect(latestSnapshot(snapshots)).toEqual(snapshots[1]);
  });
});

describe("accountBalanceWithCurrency", () => {
  it("returns snapshot currency when a stored balance exists", () => {
    expect(
      accountBalanceWithCurrency(
        [{ type: "CONTRIBUTION", amountMinor: 10_000, date: "2026-01-01", currency: "CAD" }],
        [{ balanceMinor: 25_000, currency: "USD", asOf: "2026-02-01" }],
        "CAD",
      ),
    ).toEqual({
      ok: true,
      balanceMinor: 25_000,
      currency: "USD",
      asOf: "2026-02-01",
      source: "snapshot",
    });
  });

  it("derives in account currency when every transaction matches it", () => {
    expect(
      accountBalanceWithCurrency(
        [
          { type: "CONTRIBUTION", amountMinor: 10_000, date: "2026-01-01", currency: "CAD" },
          { type: "FEE", amountMinor: 500, date: "2026-01-02", currency: "CAD" },
        ],
        [],
        "CAD",
      ),
    ).toEqual({
      ok: true,
      balanceMinor: 9_500,
      currency: "CAD",
      asOf: "2026-01-02",
      source: "derived",
    });
  });

  it("rejects mixed transaction currencies when no snapshot anchors the balance", () => {
    expect(
      accountBalanceWithCurrency(
        [
          { type: "CONTRIBUTION", amountMinor: 10_000, date: "2026-01-01", currency: "CAD" },
          { type: "DIVIDEND", amountMinor: 500, date: "2026-01-02", currency: "USD" },
        ],
        [],
        "CAD",
      ),
    ).toEqual({
      ok: false,
      error: "Cannot derive CAD balance from USD transaction without a balance snapshot",
    });
  });
});

describe("holdingValueMinor", () => {
  it("multiplies quantity by price and rounds", () => {
    expect(holdingValueMinor(10, 12345)).toBe(123450);
    expect(holdingValueMinor(0.5, 33333)).toBe(16667); // 16666.5 rounds up
  });

  it("handles fractional crypto quantities", () => {
    expect(holdingValueMinor(0.0042, 10_000_000_00)).toBe(4_200_000); // 0.0042 BTC × $10M... fictional
  });

  it("rejects non-finite quantity and non-integer price", () => {
    expect(() => holdingValueMinor(NaN, 100)).toThrow(RangeError);
    expect(() => holdingValueMinor(1, 10.5)).toThrow(RangeError);
  });

  it("rejects a rounded holding value outside the safe integer range", () => {
    expect(() => holdingValueMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});
