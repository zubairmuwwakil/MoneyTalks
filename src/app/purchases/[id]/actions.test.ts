import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { removeCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import { correctPurchaseDetails, createReturnForPurchase, keepSeparatePurchase, mergeDuplicatePurchase,
  markPurchaseDeclined, markPurchaseReversed, undoLatestPurchaseCorrection, permanentlyDeletePurchase } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/spine/cap-usage", () => ({ reverseCapAccrual: vi.fn(), removeCapAccrual: vi.fn(), applyCapAccrual: vi.fn() }));
vi.mock("@/lib/domain/ownerState", () => ({ ensureOwnerStateRecord: vi.fn(async () => null) }));
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
    walletEvent: { updateMany: vi.fn(), deleteMany: vi.fn() },
    emailTransaction: { updateMany: vi.fn() },
    statementLine: { updateMany: vi.fn() },
    purchaseItem: { updateMany: vi.fn() },
    purchaseAttachment: { updateMany: vi.fn() },
    returnItem: { updateMany: vi.fn() },
    capAccrual: { findUnique: vi.fn() },
    purchaseDuplicateDismissal: { upsert: vi.fn() },
    purchaseCorrection: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
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
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)) as never);
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

describe("purchase financial corrections", () => {
  const purchase = {
    id: "purchase-1", userId: "user-1", merchant: "Store", totalCents: 1000, currency: "CAD",
    paymentMethod: "card-1", financialState: "NORMALIZED", category: "grocery", purchasedAt: new Date(),
  };
  const tx = {
    purchase: { findFirst: vi.fn(), update: vi.fn(), updateManyAndReturn: vi.fn(), delete: vi.fn() },
    walletEvent: { updateMany: vi.fn(), deleteMany: vi.fn() },
    purchaseCorrection: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    merchantCurrencyConfirmation: { upsert: vi.fn() },
    recurringObligation: { deleteMany: vi.fn() },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)) as never);
    tx.purchase.findFirst.mockResolvedValue(purchase);
    tx.purchase.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...purchase, ...data }));
    vi.mocked(reverseCapAccrual).mockResolvedValue(true);
  });

  it("marks a declined payment, reverses its accrual, and keeps an undo snapshot", async () => {
    expect(await markPurchaseDeclined("purchase-1")).toEqual({ ok: true });
    expect(reverseCapAccrual).toHaveBeenCalledWith(tx, "purchase:purchase-1");
    expect(tx.purchase.update).toHaveBeenCalledWith({ where: { id: "purchase-1" }, data: { financialState: "DECLINED" } });
    expect(tx.purchaseCorrection.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "declined", userId: "user-1" }) });
  });

  it("distinguishes a reversal from a decline", async () => {
    expect(await markPurchaseReversed("purchase-1")).toEqual({ ok: true });
    expect(tx.purchase.update).toHaveBeenCalledWith({ where: { id: "purchase-1" }, data: { financialState: "REVERSED" } });
    expect(tx.walletEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { financialState: "REVERSED" } }));
  });

  it("does not cross a terminal financial state without Undo", async () => {
    tx.purchase.findFirst.mockResolvedValue({ ...purchase, financialState: "DECLINED" });
    expect(await markPurchaseReversed("purchase-1")).toEqual({
      ok: false, error: "Undo the terminal status before changing it",
    });
    expect(reverseCapAccrual).not.toHaveBeenCalled();
    expect(tx.purchase.update).not.toHaveBeenCalled();
  });

  it("marks a corrected currency as the owner's, so reprocessing stops restating it", async () => {
    const formData = new FormData();
    formData.set("purchaseId", "purchase-1");
    formData.set("merchant", "Store");
    formData.set("currency", "usd");
    formData.set("amount", "10.00");

    expect(await correctPurchaseDetails(formData)).toEqual({ ok: true });
    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: "USD", currencySource: "userOverride" }),
    }));
    expect(tx.merchantCurrencyConfirmation.upsert).not.toHaveBeenCalled();
    expect(tx.purchase.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it("learns currency through the owner-facing correction without crossing provenance or owner boundaries", async () => {
    tx.purchase.findFirst.mockResolvedValue({
      ...purchase,
      merchant: "heroku.com",
      currency: null,
      currencySource: "none",
    });
    tx.purchase.updateManyAndReturn.mockResolvedValue([
      { id: "heroku-none" },
      { id: "heroku-legacy-null-source" },
    ]);
    const formData = new FormData();
    formData.set("purchaseId", "purchase-1");
    formData.set("merchant", "heroku.com");
    formData.set("currency", "usd");
    formData.set("amount", "1.01");
    formData.set("rememberMerchantCurrency", "on");

    expect(await correctPurchaseDetails(formData)).toEqual({ ok: true });

    expect(tx.merchantCurrencyConfirmation.upsert).toHaveBeenCalledWith({
      where: {
        userId_merchantCanonicalId: {
          userId: "user-1",
          merchantCanonicalId: "heroku.com",
        },
      },
      create: { userId: "user-1", merchantCanonicalId: "heroku.com", currency: "USD" },
      update: { currency: "USD" },
    });
    expect(tx.purchase.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        merchant: "heroku.com",
        OR: [{ currencySource: null }, { currencySource: "none" }],
      },
      data: { currency: "USD", currencySource: "ownerConfirmedForMerchant" },
      select: { id: true },
    });
    // The selected receipt remains a per-purchase top-tier assertion. The
    // merchant-wide pass excludes explicitCode and every other owner by query.
    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: "USD", currencySource: "userOverride" }),
    }));
    expect(tx.purchaseCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        purchaseId: "purchase-1",
        kind: "details",
      }),
    });
  });

  it("carries the currency's provenance into the undo snapshot", async () => {
    // Undo restores beforeState wholesale, so a snapshot without
    // currencySource would leave the row claiming an override it no longer has.
    tx.purchase.findFirst.mockResolvedValue({ ...purchase, currencySource: "explicitCode" });
    const formData = new FormData();
    formData.set("purchaseId", "purchase-1");
    formData.set("merchant", "Store");
    formData.set("currency", "USD");
    formData.set("amount", "10.00");

    await correctPurchaseDetails(formData);

    expect(tx.purchaseCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        beforeState: expect.objectContaining({ currency: "CAD", currencySource: "explicitCode" }),
        afterState: expect.objectContaining({ currency: "USD", currencySource: "userOverride" }),
      }),
    });
  });

  it("undoes the latest non-undone correction", async () => {
    tx.purchaseCorrection.findFirst.mockResolvedValue({ id: "correction-1", beforeState: {
      merchant: "Store", totalCents: 1000, currency: "CAD", paymentMethod: "card-1", financialState: "NORMALIZED",
    } });
    expect(await undoLatestPurchaseCorrection("purchase-1")).toEqual({ ok: true });
    expect(removeCapAccrual).toHaveBeenCalledWith(tx, "purchase:purchase-1");
    expect(tx.purchaseCorrection.update).toHaveBeenCalledWith({ where: { id: "correction-1" }, data: { undoneAt: expect.any(Date) } });
  });

  it("permanent deletion removes underlying Wallet evidence and cannot be undone", async () => {
    await expect(permanentlyDeletePurchase("purchase-1")).resolves.toEqual({ ok: true });
    expect(tx.walletEvent.deleteMany).toHaveBeenCalledWith({ where: { purchaseId: "purchase-1", userId: "user-1" } });
    expect(tx.purchase.delete).toHaveBeenCalledWith({ where: { id: "purchase-1" } });
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
    } as never);
    vi.mocked(prisma.returnItem.findFirst).mockResolvedValue({ id: "ret-1" } as never);

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
    } as never);
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
    } as never);

    const formData = new FormData();
    formData.set("purchaseId", "pur-1");
    await expect(createReturnForPurchase(formData)).rejects.toThrow("REDIRECT:/returns");
  });
});
