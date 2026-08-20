import { describe, expect, it, vi } from "vitest";
import {
  captureInvestmentSnapshots,
  recomputeSnapshotFlows,
} from "./captureInvestmentSnapshots";

const AS_OF = new Date("2026-08-20T18:00:00.000Z");
const DAY = new Date("2026-08-20T00:00:00.000Z");

type AccountFixture = ReturnType<typeof accountFixture>;

function accountFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "account-1",
    userId: "user-1",
    name: "RRSP",
    type: "RRSP",
    currency: "USD",
    holdings: [
      {
        id: "holding-1",
        symbol: "AAPL",
        name: "Apple",
        quantity: 2,
        lastPriceMinor: 5_000,
        priceCurrency: "USD" as string | null,
        priceAsOf: new Date("2026-08-20T00:00:00.000Z"),
        priceSource: "YAHOO",
        priceStatus: "FRESH" as string | null,
      },
    ],
    transactions: [],
    snapshots: [
      {
        balanceMinor: 10_000,
        currency: "USD",
        asOf: new Date("2026-08-20T00:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

function prismaMock(accounts: AccountFixture[], rates: Array<Record<string, unknown>> = []) {
  let nextSnapshot = 1;
  const transactionDb = {
    investmentAccountSnapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async () => ({ id: `investment-snapshot-${nextSnapshot++}` })),
    },
    investmentPositionSnapshot: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    financialAccount: { findMany: vi.fn().mockResolvedValue(accounts) },
    fxRate: { findMany: vi.fn().mockResolvedValue(rates) },
    $transaction: vi.fn(async (callback: (tx: typeof transactionDb) => unknown) => callback(transactionDb)),
  };
  return { prisma, transactionDb };
}

describe("captureInvestmentSnapshots", () => {
  it("does not reuse an old persisted FRESH quote without evidence from this refresh run", async () => {
    const base = accountFixture();
    const { prisma, transactionDb } = prismaMock(
      [{ ...base, holdings: [{ ...base.holdings[0], priceAsOf: new Date("2026-08-19T00:00:00Z") }] }],
      [{ base: "USD", quote: "CAD", rate: 1.4, asOf: DAY }],
    );

    const result = await captureInvestmentSnapshots(prisma as never, "user-1", { asOf: AS_OF });

    expect(result).toEqual({ accounts: 1, complete: 0, partial: 1, failed: 0, failures: [] });
    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "PARTIAL", pricedHoldingCount: 0 }),
      }),
    );
  });

  it("writes a complete native and CAD valuation with FX provenance", async () => {
    const { prisma, transactionDb } = prismaMock([accountFixture()], [
      { base: "USD", quote: "CAD", rate: 1.4, asOf: new Date("2026-08-20T00:00:00.000Z") },
    ]);

    const result = await captureInvestmentSnapshots(prisma as never, "user-1", {
      asOf: AS_OF,
      validatedHoldingIds: ["holding-1"],
    });

    expect(result).toEqual({ accounts: 1, complete: 1, partial: 0, failed: 0, failures: [] });
    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenCalledWith({
      where: { accountId_asOf: { accountId: "account-1", asOf: DAY } },
      create: expect.objectContaining({
        accountId: "account-1",
        asOf: DAY,
        cashMinor: 10_000,
        holdingsMinor: 10_000,
        totalMinor: 20_000,
        displayTotalMinor: 28_000,
        fxRateToDisplay: 1.4,
        fxAsOf: DAY,
        status: "COMPLETE",
        holdingCount: 1,
        pricedHoldingCount: 1,
      }),
      update: expect.objectContaining({
        totalMinor: 20_000,
        displayTotalMinor: 28_000,
        status: "COMPLETE",
      }),
    });
    expect(transactionDb.investmentPositionSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          accountSnapshotId: "investment-snapshot-1",
          holdingId: "holding-1",
          symbol: "AAPL",
          quantity: 2,
          marketValueMinor: 10_000,
          displayMarketValueMinor: 14_000,
          valuationComplete: true,
        }),
      ],
    });
  });

  it.each([
    ["missing currency", { priceCurrency: null }],
    ["stale price", { priceStatus: "STALE" }],
    ["unavailable price", { priceStatus: "UNAVAILABLE" }],
  ])("retains a partial diagnostic snapshot for a %s", async (_label, holdingOverride) => {
    const base = accountFixture();
    const { prisma, transactionDb } = prismaMock(
      [{ ...base, holdings: [{ ...base.holdings[0], ...holdingOverride }] }],
      [{ base: "USD", quote: "CAD", rate: 1.4, asOf: DAY }],
    );

    const result = await captureInvestmentSnapshots(prisma as never, "user-1", { asOf: AS_OF });

    expect(result).toEqual({ accounts: 1, complete: 0, partial: 1, failed: 0, failures: [] });
    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "PARTIAL" }) }),
    );
    expect(transactionDb.investmentPositionSnapshot.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ valuationComplete: false })],
    });
  });

  it("captures a cash-only account as complete", async () => {
    const { prisma, transactionDb } = prismaMock([
      accountFixture({
        id: "cash-account",
        type: "CASH",
        currency: "CAD",
        holdings: [],
        snapshots: [{ balanceMinor: 25_000, currency: "CAD", asOf: DAY }],
      }),
    ]);

    const result = await captureInvestmentSnapshots(prisma as never, "user-1", { asOf: AS_OF });

    expect(result.complete).toBe(1);
    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          cashMinor: 25_000,
          holdingsMinor: 0,
          totalMinor: 25_000,
          displayTotalMinor: 25_000,
          status: "COMPLETE",
        }),
      }),
    );
    expect(transactionDb.investmentPositionSnapshot.createMany).not.toHaveBeenCalled();
  });

  it("marks a snapshot partial when an interval flow uses another currency", async () => {
    const { prisma, transactionDb } = prismaMock(
      [
        accountFixture({
          transactions: [
            {
              type: "CONTRIBUTION",
              amountMinor: 1_000,
              currency: "CAD",
              date: new Date("2026-08-20T12:00:00Z"),
            },
          ],
        }),
      ],
      [{ base: "USD", quote: "CAD", rate: 1.4, asOf: DAY }],
    );
    transactionDb.investmentAccountSnapshot.findFirst.mockResolvedValueOnce({
      asOf: new Date("2026-08-19T00:00:00Z"),
    });

    const result = await captureInvestmentSnapshots(prisma as never, "user-1", { asOf: AS_OF });

    expect(result).toEqual({ accounts: 1, complete: 0, partial: 1, failed: 0, failures: [] });
    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "PARTIAL" }) }),
    );
  });

  it("upserts and replaces positions when capture reruns on the same UTC day", async () => {
    const { prisma, transactionDb } = prismaMock([accountFixture()], [
      { base: "USD", quote: "CAD", rate: 1.4, asOf: DAY },
    ]);

    await captureInvestmentSnapshots(prisma as never, "user-1", {
      asOf: AS_OF,
      validatedHoldingIds: ["holding-1"],
    });
    await captureInvestmentSnapshots(prisma as never, "user-1", {
      asOf: new Date("2026-08-20T23:59:00.000Z"),
      validatedHoldingIds: ["holding-1"],
    });

    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenCalledTimes(2);
    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { accountId_asOf: { accountId: "account-1", asOf: DAY } } }),
    );
    expect(transactionDb.investmentPositionSnapshot.deleteMany).toHaveBeenCalledTimes(2);
    expect(transactionDb.investmentPositionSnapshot.createMany).toHaveBeenCalledTimes(2);
  });

  it("counts a failed account and continues capturing later accounts", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalid = accountFixture({
      id: "bad-account",
      holdings: [{ ...accountFixture().holdings[0], quantity: Number.NaN }],
    });
    const cash = accountFixture({
      id: "cash-account",
      currency: "CAD",
      holdings: [],
      snapshots: [{ balanceMinor: 2_500, currency: "CAD", asOf: DAY }],
    });
    const { prisma, transactionDb } = prismaMock([invalid, cash], [
      { base: "USD", quote: "CAD", rate: 1.4, asOf: DAY },
    ]);

    const result = await captureInvestmentSnapshots(prisma as never, "user-1", { asOf: AS_OF });

    expect(result).toEqual({
      accounts: 2,
      complete: 1,
      partial: 0,
      failed: 1,
      failures: [{ accountId: "bad-account", reason: "invalid decimal value" }],
    });
    expect(warning).toHaveBeenCalledWith(
      "[investment-snapshots] capture failed for account bad-account: invalid decimal value",
    );
    expect(transactionDb.investmentAccountSnapshot.upsert).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
});

describe("recomputeSnapshotFlows", () => {
  it("recomputes flows from the previous complete snapshot and does not advance on partial rows", async () => {
    const snapshots = [
      {
        id: "partial",
        asOf: new Date("2026-08-21T00:00:00.000Z"),
        currency: "USD",
        displayCurrency: "CAD",
        fxRateToDisplay: 1.4,
        status: "PARTIAL",
      },
      {
        id: "complete",
        asOf: new Date("2026-08-22T00:00:00.000Z"),
        currency: "USD",
        displayCurrency: "CAD",
        fxRateToDisplay: 1.4,
        status: "COMPLETE",
      },
    ];
    const prisma = {
      investmentAccountSnapshot: {
        findMany: vi.fn().mockResolvedValue(snapshots),
        findFirst: vi.fn().mockResolvedValue({ asOf: new Date("2026-08-20T00:00:00.000Z") }),
        update: vi.fn().mockResolvedValue({}),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { type: "CONTRIBUTION", amountMinor: 9_000, currency: "USD", date: new Date("2026-08-20T16:00:00Z") },
          { type: "CONTRIBUTION", amountMinor: 1_000, currency: "USD", date: new Date("2026-08-21") },
          { type: "WITHDRAWAL", amountMinor: 250, currency: "USD", date: new Date("2026-08-22") },
          { type: "DIVIDEND", amountMinor: 500, currency: "USD", date: new Date("2026-08-22") },
        ]),
      },
    };

    await recomputeSnapshotFlows(prisma as never, "account-1", new Date("2026-08-21"));

    expect(prisma.investmentAccountSnapshot.update).toHaveBeenNthCalledWith(1, {
      where: { id: "partial" },
      data: { netExternalFlowMinor: 1_000, displayExternalFlowMinor: 1_400 },
    });
    expect(prisma.investmentAccountSnapshot.update).toHaveBeenNthCalledWith(2, {
      where: { id: "complete" },
      data: { netExternalFlowMinor: 750, displayExternalFlowMinor: 1_050 },
    });
  });
});
