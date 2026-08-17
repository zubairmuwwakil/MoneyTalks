import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { reverseCapAccrual } from "@/lib/spine/cap-usage";
import { mergeDuplicatePurchase } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/spine/cap-usage", () => ({ reverseCapAccrual: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn() } }));

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
});
