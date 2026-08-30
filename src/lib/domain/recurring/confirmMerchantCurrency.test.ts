import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  applyMerchantCurrencyConfirmation,
  confirmMerchantCurrency,
} from "./confirmMerchantCurrency";

describe("confirmMerchantCurrency & applyMerchantCurrencyConfirmation", () => {
  const mockTx = {
    merchantCurrencyConfirmation: {
      upsert: vi.fn(),
    },
    purchase: {
      updateManyAndReturn: vi.fn(),
    },
    recurringObligation: {
      deleteMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockTx.merchantCurrencyConfirmation.upsert.mockResolvedValue({});
    mockTx.purchase.updateManyAndReturn.mockResolvedValue([
      { id: "purchase-1" },
      { id: "purchase-2" },
    ]);
    mockTx.recurringObligation.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("upserts merchant confirmation and updates only null or none currencySource rows for the specific owner", async () => {
    const input = {
      userId: "user-owner-1",
      merchantCanonicalId: "courtreserve.com",
      currency: "USD",
    };

    const result = await applyMerchantCurrencyConfirmation(mockTx as never, input);

    expect(result).toEqual({ affectedPurchases: 2 });

    // 1. Check MerchantCurrencyConfirmation upsert
    expect(mockTx.merchantCurrencyConfirmation.upsert).toHaveBeenCalledWith({
      where: {
        userId_merchantCanonicalId: {
          userId: "user-owner-1",
          merchantCanonicalId: "courtreserve.com",
        },
      },
      create: input,
      update: { currency: "USD" },
    });

    // 2. Check purchase update query scoping and provenance protection
    expect(mockTx.purchase.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        userId: "user-owner-1",
        merchant: "courtreserve.com",
        OR: [
          { currencySource: null },
          { currencySource: "none" },
        ],
      },
      data: {
        currency: "USD",
        currencySource: "ownerConfirmedForMerchant",
      },
      select: { id: true },
    });

    // 3. Check that reviewable obligations are deleted so they can re-derive
    expect(mockTx.recurringObligation.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-owner-1",
        merchantCanonicalId: "courtreserve.com",
        origin: "DETECTED",
        needsReview: true,
        evidence: { some: { purchaseId: { in: ["purchase-1", "purchase-2"] } } },
      },
    });
  });

  it("does not include explicitCode, structuredMarkup, walletObservation, or userOverride in update predicate", async () => {
    const input = {
      userId: "user-owner-1",
      merchantCanonicalId: "anthropic.com",
      currency: "USD",
    };

    await applyMerchantCurrencyConfirmation(mockTx as never, input);

    const callArgs = mockTx.purchase.updateManyAndReturn.mock.calls[0][0];
    const orConditions = callArgs.where.OR;

    // Must strictly only target null and none
    expect(orConditions).toEqual([
      { currencySource: null },
      { currencySource: "none" },
    ]);

    // Explicit check that higher provenance sources are never targeted
    expect(orConditions).not.toContainEqual({ currencySource: "explicitCode" });
    expect(orConditions).not.toContainEqual({ currencySource: "structuredMarkup" });
    expect(orConditions).not.toContainEqual({ currencySource: "walletObservation" });
    expect(orConditions).not.toContainEqual({ currencySource: "userOverride" });
  });

  it("allows replacing prior ownerConfirmedForMerchant rows when replaceLearnedPurchases is true", async () => {
    const input = {
      userId: "user-owner-1",
      merchantCanonicalId: "courtreserve.com",
      currency: "CAD",
    };

    await applyMerchantCurrencyConfirmation(mockTx as never, input, { replaceLearnedPurchases: true });

    const callArgs = mockTx.purchase.updateManyAndReturn.mock.calls[0][0];
    expect(callArgs.where.OR).toEqual([
      { currencySource: null },
      { currencySource: "none" },
      { currencySource: "ownerConfirmedForMerchant" },
    ]);
  });

  it("is strictly scoped to the owner userId and does not touch other users' data", async () => {
    const input = {
      userId: "user-specific-123",
      merchantCanonicalId: "olo.com",
      currency: "CAD",
    };

    await applyMerchantCurrencyConfirmation(mockTx as never, input);

    const callArgs = mockTx.purchase.updateManyAndReturn.mock.calls[0][0];
    expect(callArgs.where.userId).toBe("user-specific-123");
    expect(callArgs.where.userId).not.toBe("user-other-456");
  });

  it("confirmMerchantCurrency executes inside a database transaction", async () => {
    const mockDb = {
      $transaction: vi.fn((callback) => callback(mockTx)),
    } as unknown as PrismaClient;

    const input = {
      userId: "user-1",
      merchantCanonicalId: "namecheap.com",
      currency: "USD",
    };

    const result = await confirmMerchantCurrency(mockDb, input);
    expect(result).toEqual({ affectedPurchases: 2 });
    expect(mockDb.$transaction).toHaveBeenCalledOnce();
  });
});
