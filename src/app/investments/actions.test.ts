import { describe, expect, it, vi, beforeEach } from "vitest";
import { addTransaction, setCashBalance } from "./actions";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/services/marketlens", () => ({
  isMarketLensConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: {
      findFirst: vi.fn(),
    },
    balanceSnapshot: {
      upsert: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    holding: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    alert: {
      create: vi.fn(),
    },
  },
}));

describe("Investment Actions - Smart Sync & Set Cash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  describe("setCashBalance", () => {
    it("rejects invalid cash amount", async () => {
      const formData = new FormData();
      formData.append("accountId", "acc-1");
      formData.append("cashBalance", "invalid-dollars");

      const result = await setCashBalance(formData);
      expect(result.ok).toBe(false);
    });

    it("upserts a balance snapshot for valid cash amount", async () => {
      const mockAccount = { id: "acc-1", userId: "user-1", currency: "CAD", type: "TFSA" };
      vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(mockAccount as any);
      vi.mocked(prisma.balanceSnapshot.upsert).mockResolvedValue({} as any);

      const formData = new FormData();
      formData.append("accountId", "acc-1");
      formData.append("cashBalance", "1,250.50");

      const result = await setCashBalance(formData);
      expect(result.ok).toBe(true);
      expect(prisma.balanceSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.anything(),
          update: { balanceMinor: 125050 },
          create: expect.objectContaining({
            accountId: "acc-1",
            balanceMinor: 125050,
            currency: "CAD",
          }),
        }),
      );
    });
  });

  describe("addTransaction with Smart Trade Sync", () => {
    it("logs a BUY transaction and automatically creates/increments the holding", async () => {
      const mockAccount = { id: "acc-1", userId: "user-1", currency: "CAD", country: "CA", type: "TFSA" };
      vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(mockAccount as any);
      vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as any);
      vi.mocked(prisma.holding.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.holding.upsert).mockResolvedValue({} as any);

      const formData = new FormData();
      formData.append("accountId", "acc-1");
      formData.append("type", "BUY");
      formData.append("amount", "3360.00");
      formData.append("date", "2026-08-18");
      formData.append("symbol", "TSLA");
      formData.append("quantity", "10");

      const result = await addTransaction(formData);
      expect(result.ok).toBe(true);
      expect(prisma.holding.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId_symbol: { accountId: "acc-1", symbol: "TSLA" } },
          create: expect.objectContaining({
            accountId: "acc-1",
            symbol: "TSLA",
            quantity: 10,
            lastPriceMinor: 33600,
          }),
        }),
      );
    });

    it("logs a SELL transaction and decrements the holding quantity", async () => {
      const mockAccount = { id: "acc-1", userId: "user-1", currency: "CAD", country: "CA", type: "TFSA" };
      const existingHolding = { accountId: "acc-1", symbol: "TSLA", quantity: 15 as any };
      vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(mockAccount as any);
      vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-2" } as any);
      vi.mocked(prisma.holding.findUnique).mockResolvedValue(existingHolding as any);
      vi.mocked(prisma.holding.update).mockResolvedValue({} as any);

      const formData = new FormData();
      formData.append("accountId", "acc-1");
      formData.append("type", "SELL");
      formData.append("amount", "1680.00");
      formData.append("date", "2026-08-18");
      formData.append("symbol", "TSLA");
      formData.append("quantity", "5");

      const result = await addTransaction(formData);
      expect(result.ok).toBe(true);
      expect(prisma.holding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId_symbol: { accountId: "acc-1", symbol: "TSLA" } },
          data: { quantity: 10 },
        }),
      );
    });

    it("deletes the holding if remaining quantity after SELL is 0", async () => {
      const mockAccount = { id: "acc-1", userId: "user-1", currency: "CAD", country: "CA", type: "TFSA" };
      const existingHolding = { accountId: "acc-1", symbol: "TSLA", quantity: 10 as any };
      vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(mockAccount as any);
      vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-3" } as any);
      vi.mocked(prisma.holding.findUnique).mockResolvedValue(existingHolding as any);
      vi.mocked(prisma.holding.delete).mockResolvedValue({} as any);

      const formData = new FormData();
      formData.append("accountId", "acc-1");
      formData.append("type", "SELL");
      formData.append("amount", "3360.00");
      formData.append("date", "2026-08-18");
      formData.append("symbol", "TSLA");
      formData.append("quantity", "10");

      const result = await addTransaction(formData);
      expect(result.ok).toBe(true);
      expect(prisma.holding.delete).toHaveBeenCalledWith({
        where: { accountId_symbol: { accountId: "acc-1", symbol: "TSLA" } },
      });
    });
  });
});
