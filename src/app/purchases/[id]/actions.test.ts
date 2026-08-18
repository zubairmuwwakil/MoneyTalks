import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { reverseCapAccrual } from "@/lib/spine/cap-usage";
import { createReturnForPurchase, keepSeparatePurchase, mergeDuplicatePurchase } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/spine/cap-usage", () => ({ reverseCapAccrual: vi.fn() }));
vi.mock("@/lib/domain/notifications/eventNotificationScheduler", () => ({
  scheduleReturnDeadlineSoon: vi.fn(async () => {}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    purchase: { findFirst: vi.fn() },
    returnItem: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

describe("mergeDuplicatePurchase", () => {
  const tx = {
    purchase: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    walletEvent: { updateMany: vi.fn() },
    emailTransaction: { updateMany: vi.fn() },
    statementLine: { updateMany: vi.fn() },
    purchaseItem: { updateMany: vi.fn() },
    purchaseAttachment: { updateMany: vi.fn() },
    returnItem: { updateMany: vi.fn() },
    capAccrual: { findUnique: vi.fn() },
    purchaseDuplicateDismissal: { upsert: vi.fn() },
  };

  const flagged = {
    id: "dup-1", possibleDuplicateOfId: "target-1", source: "WALLET",
    purchasedAt: new Date("2026-08-16T22:25:31Z"),
    paymentMethod: "amex-cobalt", category: "dining", orderNumber: null, totalCents: 642,
  };
  const target = {
    id: "target-1", possibleDuplicateOfId: null, source: "GMAIL",
    purchasedAt: new Date("2026-08-16T21:00:00Z"),
    paymentMethod: null, category: null, orderNumber: "A1", totalCents: 642,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));
    tx.purchase.findFirst.mockResolvedValueOnce(flagged).mockResolvedValueOnce(target);
  });

  it("folds the duplicate into the canonical purchase and reverses its double accrual", async () => {
    tx.capAccrual.findUnique
      .mockResolvedValueOnce({ id: "acc-target" })
      .mockResolvedValueOnce({ id: "acc-dup" });

    await expect(mergeDuplicatePurchase("dup-1")).rejects.toThrow("REDIRECT:/purchases/target-1");

    for (const delegate of [tx.walletEvent, tx.emailTransaction, tx.statementLine, tx.purchaseItem, tx.purchaseAttachment, tx.returnItem]) {
      expect(delegate.updateMany).toHaveBeenCalledWith({
        where: { purchaseId: "dup-1" },
        data: { purchaseId: "target-1" },
      });
    }
    expect(tx.purchase.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: expect.objectContaining({
        paymentMethod: "amex-cobalt",
        category: "dining",
        orderNumber: "A1",
        purchasedAt: flagged.purchasedAt,
      }),
    });
    expect(reverseCapAccrual).toHaveBeenCalledWith(tx, "purchase:dup-1");
    expect(tx.purchase.delete).toHaveBeenCalledWith({ where: { id: "dup-1" } });
  });

  it("keeps a single accrual untouched — reversal only happens when both rows accrued", async () => {
    tx.capAccrual.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "acc-dup" });

    await expect(mergeDuplicatePurchase("dup-1")).rejects.toThrow("REDIRECT:/purchases/target-1");

    expect(reverseCapAccrual).not.toHaveBeenCalled();
  });

  it("durably records a keep-separate decision before clearing the flag", async () => {
    await keepSeparatePurchase("dup-1");

    expect(tx.purchaseDuplicateDismissal.upsert).toHaveBeenCalledWith({
      where: {
        userId_purchaseLowId_purchaseHighId: {
          userId: "user-1",
          purchaseLowId: "dup-1",
          purchaseHighId: "target-1",
        },
      },
      create: {
        userId: "user-1",
        purchaseLowId: "dup-1",
        purchaseHighId: "target-1",
      },
      update: {},
    });
    expect(tx.purchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: "dup-1",
        userId: "user-1",
        possibleDuplicateOfId: "target-1",
      },
      data: { possibleDuplicateOfId: null },
    });
  });
});

describe("createReturnForPurchase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error on missing purchaseId", async () => {
    const formData = new FormData();
    const res = await createReturnForPurchase(formData);
    expect(res).toEqual({ ok: false, error: "Invalid purchase ID" });
  });

  it("returns error if purchase is not found", async () => {
    vi.mocked(prisma.purchase.findFirst).mockResolvedValue(null);
    const formData = new FormData();
    formData.set("purchaseId", "pur-missing");
    const res = await createReturnForPurchase(formData);
    expect(res).toEqual({ ok: false, error: "Purchase not found" });
  });

  it("returns error if return already exists", async () => {
    vi.mocked(prisma.purchase.findFirst).mockResolvedValue({
      id: "pur-1",
      userId: "user-1",
      merchant: "Best Buy",
      totalCents: 9900,
      currency: "CAD",
      purchasedAt: new Date("2026-08-01"),
    } as any);
    vi.mocked(prisma.returnItem.findFirst).mockResolvedValue({ id: "ret-1" } as any);

    const formData = new FormData();
    formData.set("purchaseId", "pur-1");
    const res = await createReturnForPurchase(formData);
    expect(res).toEqual({ ok: false, error: "A return already exists for this purchase" });
  });

  it("creates return and redirects to /returns", async () => {
    vi.mocked(prisma.purchase.findFirst).mockResolvedValue({
      id: "pur-1",
      userId: "user-1",
      merchant: "Best Buy",
      totalCents: 9900,
      currency: "CAD",
      purchasedAt: new Date("2026-08-01"),
    } as any);
    vi.mocked(prisma.returnItem.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.returnItem.create).mockResolvedValue({
      id: "ret-1",
      userId: "user-1",
      store: "Best Buy",
      itemNote: null,
      returnBy: new Date("2026-08-31"),
      amountCents: 9900,
      currency: "CAD",
      status: "OPEN",
    } as any);

    const formData = new FormData();
    formData.set("purchaseId", "pur-1");
    await expect(createReturnForPurchase(formData)).rejects.toThrow("REDIRECT:/returns");
  });
});
