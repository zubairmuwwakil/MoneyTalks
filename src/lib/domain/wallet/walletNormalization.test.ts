import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processWalletEvents } from "./walletNormalization";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    walletEvent: { findMany: vi.fn() },
    merchantAlias: { findUnique: vi.fn() },
    cardAlias: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/spine/cap-usage", () => ({
  applyCapAccrual: vi.fn(),
  reverseCapAccrual: vi.fn(),
}));

describe("processWalletEvents", () => {
  const tx = {
    purchase: { findFirst: vi.fn(), create: vi.fn() },
    ownerStateRecord: { findUnique: vi.fn(), create: vi.fn() },
    creditCard: { findMany: vi.fn() },
    walletEvent: { update: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));
  });

  it("stamps merchantNormalized and resolvedCardId when normalizing", async () => {
    const event = {
      id: "evt-1", userId: "user-1", eventId: "wevt_1",
      merchantRaw: "SQ *CAFE", cardRaw: "Amex Cobalt",
      amountRaw: new Prisma.Decimal("6.42"), currencyRaw: "CAD",
      capturedAt: new Date("2026-08-16T22:25:31Z"),
    };
    vi.mocked(prisma.walletEvent.findMany)
      .mockResolvedValueOnce([event] as any)
      .mockResolvedValueOnce([]);
    vi.mocked(prisma.merchantAlias.findUnique).mockResolvedValue({ normalizedName: "Cafe", category: "dining" } as any);
    vi.mocked(prisma.cardAlias.findUnique).mockResolvedValue({ cardId: "amex-cobalt" } as any);
    tx.purchase.findFirst.mockResolvedValue(null);
    tx.ownerStateRecord.findUnique.mockResolvedValue(null);
    tx.creditCard.findMany.mockResolvedValue([]);

    const processed = await processWalletEvents();

    expect(processed).toBe(1);
    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalCents: 642, merchant: "Cafe" }),
    }));
    expect(tx.walletEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: {
        processingStatus: "NORMALIZED",
        merchantNormalized: "Cafe",
        resolvedCardId: "amex-cobalt",
      },
    });
  });
});
