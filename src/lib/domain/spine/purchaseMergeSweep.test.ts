import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sweepPurchaseDuplicateFlags } from "./purchaseMergeSweep";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    purchase: { findMany: vi.fn(), updateMany: vi.fn() },
    purchaseDuplicateDismissal: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const none = { walletEvents: 0, emailTransactions: 0, statementLines: 0 };

function purchase(overrides: Record<string, unknown>) {
  return {
    id: "purchase",
    userId: "user-1",
    merchant: "Starbucks",
    totalCents: 642,
    currency: "CAD",
    purchasedAt: new Date("2026-08-16T12:00:00Z"),
    createdAt: new Date("2026-08-16T12:01:00Z"),
    source: "WALLET",
    possibleDuplicateOfId: null,
    _count: none,
    ...overrides,
  };
}

describe("sweepPurchaseDuplicateFlags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.purchaseDuplicateDismissal.findMany).mockResolvedValue([]);
    vi.mocked(prisma.purchaseDuplicateDismissal.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.purchase.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma));
  });

  it("flags only the newer row for exact and merchant-uncertain matches outside 72 hours", async () => {
    vi.mocked(prisma.purchase.findMany).mockResolvedValue([
      purchase({
        id: "gmail-old-exact",
        source: "GMAIL",
        purchasedAt: new Date("2026-08-11T12:00:00Z"),
        createdAt: new Date("2026-08-11T12:01:00Z"),
      }),
      purchase({ id: "wallet-new-exact" }),
      purchase({
        id: "gmail-old-possible",
        userId: "user-2",
        merchant: "Unknown Storefront",
        totalCents: 500,
        source: "GMAIL",
        purchasedAt: new Date("2026-08-12T12:00:00Z"),
        createdAt: new Date("2026-08-12T12:01:00Z"),
      }),
      purchase({
        id: "wallet-new-possible",
        userId: "user-2",
        merchant: "Corner Shop",
        totalCents: 500,
      }),
    ] as any);

    const result = await sweepPurchaseDuplicateFlags(new Date("2026-08-17T12:00:00Z"));

    expect(result).toEqual({ scanned: 4, matched: 2, flagged: 2, dismissed: 0 });
    expect(prisma.purchase.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.purchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "wallet-new-exact", possibleDuplicateOfId: null }),
      data: { possibleDuplicateOfId: "gmail-old-exact" },
    }));
    expect(prisma.purchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "wallet-new-possible", possibleDuplicateOfId: null }),
      data: { possibleDuplicateOfId: "gmail-old-possible" },
    }));
  });

  it("does not re-flag a pair the user kept separate", async () => {
    vi.mocked(prisma.purchase.findMany).mockResolvedValue([
      purchase({
        id: "gmail-old",
        source: "GMAIL",
        purchasedAt: new Date("2026-08-12T12:00:00Z"),
        createdAt: new Date("2026-08-12T12:01:00Z"),
      }),
      purchase({ id: "wallet-new" }),
    ] as any);
    vi.mocked(prisma.purchaseDuplicateDismissal.findMany).mockResolvedValue([
      {
        id: "dismissal-1",
        userId: "user-1",
        purchaseLowId: "gmail-old",
        purchaseHighId: "wallet-new",
        dismissedAt: new Date("2026-08-16T12:00:00Z"),
      },
    ]);

    const result = await sweepPurchaseDuplicateFlags(new Date("2026-08-17T12:00:00Z"));

    expect(result).toEqual({ scanned: 2, matched: 1, flagged: 0, dismissed: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.purchase.updateMany).not.toHaveBeenCalled();
  });

  it("skips an otherwise eligible row that already has second-source evidence", async () => {
    vi.mocked(prisma.purchase.findMany).mockResolvedValue([
      purchase({
        id: "gmail-old",
        source: "GMAIL",
        purchasedAt: new Date("2026-08-12T12:00:00Z"),
        createdAt: new Date("2026-08-12T12:01:00Z"),
      }),
      purchase({
        id: "wallet-enriched",
        _count: { ...none, emailTransactions: 1 },
      }),
    ] as any);

    const result = await sweepPurchaseDuplicateFlags(new Date("2026-08-17T12:00:00Z"));

    expect(result).toEqual({ scanned: 1, matched: 0, flagged: 0, dismissed: 0 });
    expect(prisma.purchase.updateMany).not.toHaveBeenCalled();
  });
});
