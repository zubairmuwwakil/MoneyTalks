import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processWalletEvents } from "./walletNormalization";
import { applyCapAccrual } from "@/lib/spine/cap-usage";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    walletEvent: { findMany: vi.fn() },
    merchantAlias: { findUnique: vi.fn(), create: vi.fn() },
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
    purchase: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
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
    tx.purchase.findMany.mockResolvedValue([]);
    tx.purchase.create.mockResolvedValue({ id: "purch-1" });
    tx.ownerStateRecord.findUnique.mockResolvedValue(null);
    tx.creditCard.findMany.mockResolvedValue([]);

    const processed = await processWalletEvents();

    expect(processed).toBe(1);
    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalCents: 642, merchant: "Cafe", possibleDuplicateOfId: null }),
    }));
    expect(tx.walletEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: {
        processingStatus: "NORMALIZED",
        merchantNormalized: "Cafe",
        resolvedCardId: "amex-cobalt",
        purchaseId: "purch-1",
      },
    });
  });

  it("merges a wallet event into an existing cross-source purchase instead of duplicating", async () => {
    const event = {
      id: "evt-2", userId: "user-1", eventId: "wevt_2",
      merchantRaw: "STARBUCKS #1234", cardRaw: "Amex Cobalt",
      amountRaw: new Prisma.Decimal("6.42"), currencyRaw: "CAD",
      capturedAt: new Date("2026-08-16T22:25:31Z"),
    };
    const gmailPurchase = {
      id: "purch-gmail", merchant: "Starbucks", totalCents: 642,
      currency: null,
      purchasedAt: new Date("2026-08-16T21:00:00Z"), paymentMethod: null, category: null,
    };
    vi.mocked(prisma.walletEvent.findMany)
      .mockResolvedValueOnce([event] as any)
      .mockResolvedValueOnce([]);
    vi.mocked(prisma.merchantAlias.findUnique).mockResolvedValue({ normalizedName: "Starbucks", category: "dining" } as any);
    vi.mocked(prisma.cardAlias.findUnique).mockResolvedValue({ cardId: "amex-cobalt" } as any);
    tx.purchase.findFirst.mockResolvedValue(null);
    tx.purchase.findMany.mockResolvedValue([gmailPurchase]);
    tx.purchase.update.mockResolvedValue({ ...gmailPurchase, purchasedAt: event.capturedAt });
    tx.ownerStateRecord.findUnique.mockResolvedValue(null);
    tx.creditCard.findMany.mockResolvedValue([]);

    await processWalletEvents();

    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(tx.purchase.update).toHaveBeenCalledWith({
      where: { id: "purch-gmail" },
      data: expect.objectContaining({
        purchasedAt: event.capturedAt,
        paymentMethod: "amex-cobalt",
        category: "dining",
        currency: "CAD",
      }),
    });
    expect(tx.walletEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purchaseId: "purch-gmail" }),
    }));
  });

  it("auto-creates a merchant alias on first sighting so events can promote", async () => {
    const event = {
      id: "evt-3", userId: "user-1", eventId: "wevt_3",
      merchantRaw: "Blue Bottle Coffee", cardRaw: null,
      amountRaw: new Prisma.Decimal("5.00"), currencyRaw: "CAD",
      capturedAt: new Date("2026-08-16T22:25:31Z"),
    };
    vi.mocked(prisma.walletEvent.findMany)
      .mockResolvedValueOnce([event] as any)
      .mockResolvedValueOnce([]);
    vi.mocked(prisma.merchantAlias.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.merchantAlias.create).mockResolvedValue({ normalizedName: "Blue Bottle Coffee", category: null } as any);
    tx.purchase.findFirst.mockResolvedValue(null);
    tx.purchase.findMany.mockResolvedValue([]);
    tx.purchase.create.mockResolvedValue({ id: "purch-2" });
    tx.ownerStateRecord.findUnique.mockResolvedValue(null);
    tx.creditCard.findMany.mockResolvedValue([]);

    const processed = await processWalletEvents();

    expect(processed).toBe(1);
    expect(prisma.merchantAlias.create).toHaveBeenCalledWith({
      data: { rawString: "Blue Bottle Coffee", normalizedName: "Blue Bottle Coffee" },
    });
    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ merchant: "Blue Bottle Coffee", category: null }),
    }));
  });

  it("preserves an unknown currency and does not accrue it as CAD", async () => {
    const event = {
      id: "evt-4", userId: "user-1", eventId: "wevt_4",
      merchantRaw: "Cafe", cardRaw: "Amex Cobalt",
      amountRaw: new Prisma.Decimal("6.42"), currencyRaw: null,
      capturedAt: new Date("2026-08-16T22:25:31Z"),
    };
    vi.mocked(prisma.walletEvent.findMany)
      .mockResolvedValueOnce([event] as any)
      .mockResolvedValueOnce([]);
    vi.mocked(prisma.merchantAlias.findUnique).mockResolvedValue({ normalizedName: "Cafe", category: "dining" } as any);
    vi.mocked(prisma.cardAlias.findUnique).mockResolvedValue({ cardId: "amex-cobalt" } as any);
    tx.purchase.findFirst.mockResolvedValue(null);
    tx.purchase.findMany.mockResolvedValue([]);
    tx.purchase.create.mockResolvedValue({ id: "purch-4", currency: null });
    tx.ownerStateRecord.findUnique.mockResolvedValue({ stateData: { cardStates: {} } });

    await processWalletEvents();

    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: null }),
    }));
    expect(applyCapAccrual).not.toHaveBeenCalled();
  });

  it("normalizes an event with unmapped cardRaw (no cardAlias) — paymentMethod stays null, no cap accrual", async () => {
    const event = {
      id: "evt-5", userId: "user-1", eventId: "wevt_5",
      merchantRaw: "Metro", cardRaw: "Aventura Visa Platinum",
      amountRaw: new Prisma.Decimal("32.10"), currencyRaw: "CAD",
      capturedAt: new Date("2026-08-17T14:00:00Z"),
    };
    vi.mocked(prisma.walletEvent.findMany)
      .mockResolvedValueOnce([event] as any)
      .mockResolvedValueOnce([]);
    vi.mocked(prisma.merchantAlias.findUnique).mockResolvedValue({ normalizedName: "Metro", category: "grocery" } as any);
    // No card alias exists for this raw string
    vi.mocked(prisma.cardAlias.findUnique).mockResolvedValue(null);
    tx.purchase.findFirst.mockResolvedValue(null);
    tx.purchase.findMany.mockResolvedValue([]);
    tx.purchase.create.mockResolvedValue({ id: "purch-5", currency: "CAD" });
    tx.ownerStateRecord.findUnique.mockResolvedValue({ stateData: { cardStates: {} } });
    tx.creditCard.findMany.mockResolvedValue([]);

    const processed = await processWalletEvents();

    expect(processed).toBe(1);
    // Purchase created without a paymentMethod
    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ merchant: "Metro", totalCents: 3210 }),
    }));
    const createCall = vi.mocked(tx.purchase.create).mock.calls[0][0] as any;
    expect(createCall.data.paymentMethod).toBeUndefined();
    // Event transitions to NORMALIZED with resolvedCardId null
    expect(tx.walletEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-5" },
      data: {
        processingStatus: "NORMALIZED",
        merchantNormalized: "Metro",
        resolvedCardId: null,
        purchaseId: "purch-5",
      },
    });
    // Cap accrual skipped because no card alias
    expect(applyCapAccrual).not.toHaveBeenCalled();
  });
});

