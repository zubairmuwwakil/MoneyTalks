import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { updateMerchantAlias } from "./actions";

vi.mock("@/lib/require-user", () => ({
  requireUserId: vi.fn(async () => "user-1"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/domain/recurring/confirmMerchantCurrency", () => ({
  confirmMerchantCurrency: vi.fn(),
}));

vi.mock("@/lib/domain/recurring/detectRecurring", () => ({
  sweepRecurringObligations: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    merchantAlias: { upsert: vi.fn() },
    purchase: { updateMany: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
  },
}));

describe("updateMerchantAlias", () => {
  const tx = {
    merchantAlias: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    walletEvent: {
      updateMany: vi.fn(),
    },
    purchase: {
      updateMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  });

  it("rejects invalid input with empty normalizedName", async () => {
    const result = await updateMerchantAlias({
      id: "alias-1",
      normalizedName: "   ",
      category: "dining",
    });

    expect(result).toEqual({
      ok: false,
      error: "Merchant name cannot be empty",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns an error if the alias does not exist", async () => {
    tx.merchantAlias.findUnique.mockResolvedValueOnce(null);

    const result = await updateMerchantAlias({
      id: "missing-id",
      normalizedName: "Cafe Bleu",
      category: "dining",
    });

    expect(result).toEqual({
      ok: false,
      error: "Merchant alias not found",
    });
    expect(tx.merchantAlias.update).not.toHaveBeenCalled();
  });

  it("updates normalizedName and category, and backfills WalletEvent and Purchase rows", async () => {
    const existing = {
      id: "alias-1",
      rawString: "SQ *CAFE BLEU",
      normalizedName: "SQ *CAFE BLEU",
      category: null,
    };
    tx.merchantAlias.findUnique.mockResolvedValueOnce(existing);
    tx.merchantAlias.update.mockResolvedValueOnce({
      id: "alias-1",
      rawString: "SQ *CAFE BLEU",
      normalizedName: "Café Bleu",
      category: "dining",
    });

    const result = await updateMerchantAlias({
      id: "alias-1",
      normalizedName: "  Café Bleu  ",
      category: "  dining  ",
    });

    expect(result).toEqual({
      ok: true,
      alias: {
        id: "alias-1",
        rawString: "SQ *CAFE BLEU",
        normalizedName: "Café Bleu",
        category: "dining",
      },
    });

    expect(tx.merchantAlias.update).toHaveBeenCalledWith({
      where: { id: "alias-1" },
      data: {
        normalizedName: "Café Bleu",
        category: "dining",
      },
    });

    // Verify backfill for WalletEvent
    expect(tx.walletEvent.updateMany).toHaveBeenCalledWith({
      where: {
        merchantRaw: "SQ *CAFE BLEU",
        merchantNormalized: "SQ *CAFE BLEU",
      },
      data: {
        merchantNormalized: "Café Bleu",
      },
    });

    // Verify backfill for Purchase
    expect(tx.purchase.updateMany).toHaveBeenCalledWith({
      where: {
        merchant: "SQ *CAFE BLEU",
        walletEvents: {
          some: {
            merchantRaw: "SQ *CAFE BLEU",
          },
        },
      },
      data: {
        merchant: "Café Bleu",
      },
    });

    expect(revalidatePath).toHaveBeenCalledWith("/settings/merchants");
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
    expect(revalidatePath).toHaveBeenCalledWith("/cards/reconcile");
  });

  it("skips backfilling WalletEvent and Purchase when normalizedName is not changed", async () => {
    const existing = {
      id: "alias-1",
      rawString: "SQ *CAFE BLEU",
      normalizedName: "Café Bleu",
      category: null,
    };
    tx.merchantAlias.findUnique.mockResolvedValueOnce(existing);
    tx.merchantAlias.update.mockResolvedValueOnce({
      id: "alias-1",
      rawString: "SQ *CAFE BLEU",
      normalizedName: "Café Bleu",
      category: "dining",
    });

    const result = await updateMerchantAlias({
      id: "alias-1",
      normalizedName: "Café Bleu",
      category: "dining",
    });

    expect(result).toEqual({
      ok: true,
      alias: {
        id: "alias-1",
        rawString: "SQ *CAFE BLEU",
        normalizedName: "Café Bleu",
        category: "dining",
      },
    });

    expect(tx.merchantAlias.update).toHaveBeenCalledWith({
      where: { id: "alias-1" },
      data: {
        normalizedName: "Café Bleu",
        category: "dining",
      },
    });

    expect(tx.walletEvent.updateMany).not.toHaveBeenCalled();
    expect(tx.purchase.updateMany).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/settings/merchants");
  });

  it("handles clearing the category to null", async () => {
    const existing = {
      id: "alias-1",
      rawString: "AMZN MKTP",
      normalizedName: "Amazon",
      category: "shopping",
    };
    tx.merchantAlias.findUnique.mockResolvedValueOnce(existing);
    tx.merchantAlias.update.mockResolvedValueOnce({
      id: "alias-1",
      rawString: "AMZN MKTP",
      normalizedName: "Amazon",
      category: null,
    });

    const result = await updateMerchantAlias({
      id: "alias-1",
      normalizedName: "Amazon",
      category: "",
    });

    expect(result.ok).toBe(true);
    expect(tx.merchantAlias.update).toHaveBeenCalledWith({
      where: { id: "alias-1" },
      data: {
        normalizedName: "Amazon",
        category: null,
      },
    });
  });
});

describe("setMerchantCategory", () => {
  it("upserts merchant alias and updates user purchases", async () => {
    const { setMerchantCategory } = await import("./actions");
    vi.mocked(prisma.merchantAlias.upsert).mockResolvedValue({
      id: "alias-2",
      rawString: "SQ *CAFE",
      normalizedName: "SQ *CAFE",
      category: "dining",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.purchase.updateMany).mockResolvedValue({ count: 2 });

    const res = await setMerchantCategory({ rawString: "SQ *CAFE", category: "dining" });

    expect(res).toEqual({ ok: true, category: "dining" });
    expect(prisma.merchantAlias.upsert).toHaveBeenCalledWith({
      where: { rawString: "SQ *CAFE" },
      create: { rawString: "SQ *CAFE", normalizedName: "SQ *CAFE", category: "dining" },
      update: { category: "dining" },
    });
    expect(prisma.purchase.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { merchant: "SQ *CAFE" },
          { walletEvents: { some: { merchantRaw: "SQ *CAFE" } } },
        ],
      },
      data: { category: "dining" },
    });
  });
});

describe("confirmMerchantCurrencyAction", () => {
  it("validates inputs and executes confirmMerchantCurrency", async () => {
    const { confirmMerchantCurrencyAction } = await import("./actions");
    const { confirmMerchantCurrency } = await import("@/lib/domain/recurring/confirmMerchantCurrency");

    vi.mocked(confirmMerchantCurrency).mockResolvedValue({ affectedPurchases: 4 });
    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue({ timezone: "America/Toronto" } as never);

    const res = await confirmMerchantCurrencyAction({
      merchantCanonicalId: "courtreserve.com",
      currency: "usd",
    });

    expect(res).toEqual({ ok: true, affectedPurchases: 4 });
    expect(confirmMerchantCurrency).toHaveBeenCalledWith(
      prisma,
      {
        userId: "user-1",
        merchantCanonicalId: "courtreserve.com",
        currency: "USD",
      },
      { replaceLearnedPurchases: true },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/merchants");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/automation/review");
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("rejects invalid currency code", async () => {
    const { confirmMerchantCurrencyAction } = await import("./actions");

    const res = await confirmMerchantCurrencyAction({
      merchantCanonicalId: "courtreserve.com",
      currency: "US",
    });

    expect(res).toEqual({ ok: false, error: "Currency must be a 3-letter code" });
  });

  it("rejects empty merchant canonical id", async () => {
    const { confirmMerchantCurrencyAction } = await import("./actions");

    const res = await confirmMerchantCurrencyAction({
      merchantCanonicalId: "   ",
      currency: "USD",
    });

    expect(res).toEqual({ ok: false, error: "Merchant name required" });
  });
});

