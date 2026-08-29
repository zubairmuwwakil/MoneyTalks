"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { applyCapAccrual, removeCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import { orderedPurchasePair } from "@/lib/domain/spine/purchaseMerge";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import type { OwnerState } from "@/engine/cards-twin";
import type { Prisma } from "@prisma/client";

const idInput = z.string().min(1);

type PurchaseSnapshot = { merchant: string; totalCents: number | null; currency: string | null;
  currencySource: string | null;
  paymentMethod: string | null; financialState: "NORMALIZED" | "RECONCILED" | "ADJUSTED" | "DECLINED" | "REVERSED" };
// currencySource travels with currency: undo restores this snapshot wholesale,
// so omitting it would leave the row claiming an override it no longer has.
const snapshot = (p: PurchaseSnapshot) => ({ merchant: p.merchant, totalCents: p.totalCents,
  currency: p.currency, currencySource: p.currencySource, paymentMethod: p.paymentMethod,
  financialState: p.financialState });

async function replacePurchaseAccrual(tx: Prisma.TransactionClient, purchase: PurchaseSnapshot & { id: string; userId: string; category: string | null; purchasedAt: Date }) {
  await removeCapAccrual(tx, `purchase:${purchase.id}`);
  if (["DECLINED", "REVERSED"].includes(purchase.financialState) || purchase.totalCents == null ||
      !purchase.paymentMethod || purchase.currency?.toUpperCase() !== "CAD") return;
  const owner = await ensureOwnerStateRecord(tx, purchase.userId);
  if (!owner) return;
  await applyCapAccrual(tx, { sourceKey: `purchase:${purchase.id}`, userId: purchase.userId,
    cardId: purchase.paymentMethod, category: purchase.category, merchantBrand: purchase.merchant,
    amountMinor: purchase.totalCents, currency: purchase.currency, occurredAt: purchase.purchasedAt },
    owner.stateData as unknown as OwnerState);
}

async function setFinancialState(purchaseIdRaw: unknown, state: "DECLINED" | "REVERSED") {
  const userId = await requireUserId(); const parsed = idInput.safeParse(purchaseIdRaw);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  const changed = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findFirst({ where: { id: parsed.data, userId } });
    if (!purchase) return "missing" as const;
    if (purchase.financialState === "DECLINED" || purchase.financialState === "REVERSED") {
      return "invalidTransition" as const;
    }
    const before = snapshot(purchase); const after = { ...before, financialState: state };
    await reverseCapAccrual(tx, `purchase:${purchase.id}`);
    await tx.purchase.update({ where: { id: purchase.id }, data: { financialState: state } });
    await tx.walletEvent.updateMany({ where: { purchaseId: purchase.id }, data: { financialState: state } });
    await tx.purchaseCorrection.create({ data: { userId, purchaseId: purchase.id, kind: state.toLowerCase(), beforeState: before, afterState: after } });
    return "changed" as const;
  });
  if (changed !== "changed") return { ok: false as const,
    error: changed === "missing" ? "purchase not found" : "Undo the terminal status before changing it" };
  revalidatePath(`/purchases/${parsed.data}`); revalidatePath("/purchases"); return { ok: true as const };
}

export async function markPurchaseDeclined(purchaseId: unknown) { return setFinancialState(purchaseId, "DECLINED"); }
export async function markPurchaseReversed(purchaseId: unknown) { return setFinancialState(purchaseId, "REVERSED"); }

export async function correctPurchaseDetails(formData: FormData) {
  const userId = await requireUserId(); const id = idInput.safeParse(formData.get("purchaseId"));
  const merchant = z.string().trim().min(1).max(200).safeParse(formData.get("merchant"));
  const currency = z.string().trim().length(3).transform((v) => v.toUpperCase()).safeParse(formData.get("currency"));
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = amountRaw === "" ? null : Number(amountRaw);
  if (!id.success || !merchant.success || !currency.success || (amount != null && (!Number.isFinite(amount) || amount < 0))) return { ok: false as const, error: "invalid details" };
  const paymentMethod = String(formData.get("paymentMethod") ?? "").trim() || null;
  const corrected = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findFirst({ where: { id: id.data, userId } });
    if (!purchase) return "missing" as const;
    if (purchase.financialState === "DECLINED" || purchase.financialState === "REVERSED") {
      return "invalidTransition" as const;
    }
    const before = snapshot(purchase);
    const updated = await tx.purchase.update({ where: { id: purchase.id }, data: { merchant: merchant.data,
      totalCents: amount == null ? null : Math.round(amount * 100), currency: currency.data,
      // The owner's answer is the top tier of src/lib/domain/receipts/resolveCurrency.ts:
      // marking it is what stops the next Gmail reprocess from restating the unit.
      currencySource: "userOverride",
      paymentMethod, financialState: "ADJUSTED" } });
    await tx.walletEvent.updateMany({ where: { purchaseId: purchase.id }, data: { financialState: "ADJUSTED" } });
    await replacePurchaseAccrual(tx, updated);
    await tx.purchaseCorrection.create({ data: { userId, purchaseId: purchase.id, kind: "details",
      beforeState: before, afterState: snapshot(updated) } });
    return "changed" as const;
  });
  if (corrected !== "changed") return { ok: false as const,
    error: corrected === "missing" ? "purchase not found" : "Undo the terminal status before editing details" };
  revalidatePath(`/purchases/${id.data}`); revalidatePath("/purchases"); return { ok: true as const };
}

export async function undoLatestPurchaseCorrection(purchaseIdRaw: unknown) {
  const userId = await requireUserId(); const parsed = idInput.safeParse(purchaseIdRaw);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  const undone = await prisma.$transaction(async (tx) => {
    const correction = await tx.purchaseCorrection.findFirst({ where: { purchaseId: parsed.data, userId, undoneAt: null }, orderBy: { createdAt: "desc" } });
    if (!correction) return false;
    const before = correction.beforeState as unknown as PurchaseSnapshot;
    const purchase = await tx.purchase.update({ where: { id: parsed.data }, data: before });
    await tx.walletEvent.updateMany({ where: { purchaseId: parsed.data }, data: { financialState: before.financialState } });
    await replacePurchaseAccrual(tx, purchase);
    await tx.purchaseCorrection.update({ where: { id: correction.id }, data: { undoneAt: new Date() } });
    return true;
  });
  if (!undone) return { ok: false as const, error: "nothing safe to undo" };
  revalidatePath(`/purchases/${parsed.data}`); revalidatePath("/purchases"); return { ok: true as const };
}

export async function permanentlyDeletePurchase(purchaseIdRaw: unknown) {
  const userId = await requireUserId(); const parsed = idInput.safeParse(purchaseIdRaw);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  const deleted = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findFirst({ where: { id: parsed.data, userId }, select: { id: true } });
    if (!purchase) return false;
    await reverseCapAccrual(tx, `purchase:${purchase.id}`);
    await tx.walletEvent.deleteMany({ where: { purchaseId: purchase.id, userId } });
    await tx.purchase.delete({ where: { id: purchase.id } }); return true;
  });
  if (!deleted) return { ok: false as const, error: "purchase not found" };
  revalidatePath("/purchases"); return { ok: true as const };
}

// User confirmed a flagged near-match IS the same purchase: fold the flagged
// row into its canonical counterpart — observations, items, attachments, and
// returns move over; gaps fill; the duplicate row disappears.
export async function mergeDuplicatePurchase(purchaseIdRaw: unknown) {
  const userId = await requireUserId();
  const parsed = idInput.safeParse(purchaseIdRaw);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  const flaggedId = parsed.data;

  const targetId = await prisma.$transaction(async (tx) => {
    const flagged = await tx.purchase.findFirst({
      where: { id: flaggedId, userId },
      select: {
        id: true, possibleDuplicateOfId: true, source: true, purchasedAt: true,
        paymentMethod: true, category: true, orderNumber: true, totalCents: true,
      },
    });
    if (!flagged?.possibleDuplicateOfId) return null;
    const target = await tx.purchase.findFirst({
      where: { id: flagged.possibleDuplicateOfId, userId },
    });
    if (!target) return null;

    await tx.walletEvent.updateMany({ where: { purchaseId: flagged.id }, data: { purchaseId: target.id } });
    await tx.emailTransaction.updateMany({ where: { purchaseId: flagged.id }, data: { purchaseId: target.id } });
    await tx.statementLine.updateMany({ where: { purchaseId: flagged.id }, data: { purchaseId: target.id } });
    await tx.purchaseItem.updateMany({ where: { purchaseId: flagged.id }, data: { purchaseId: target.id } });
    await tx.purchaseAttachment.updateMany({ where: { purchaseId: flagged.id }, data: { purchaseId: target.id } });
    await tx.returnItem.updateMany({ where: { purchaseId: flagged.id }, data: { purchaseId: target.id } });

    // Fill gaps only; a wallet-sourced duplicate contributes the tap instant.
    await tx.purchase.update({
      where: { id: target.id },
      data: {
        paymentMethod: target.paymentMethod ?? flagged.paymentMethod ?? undefined,
        category: target.category ?? flagged.category ?? undefined,
        orderNumber: target.orderNumber ?? flagged.orderNumber ?? undefined,
        totalCents: target.totalCents ?? flagged.totalCents ?? undefined,
        ...(flagged.source === "WALLET" ? { purchasedAt: flagged.purchasedAt } : {}),
      },
    });

    // The same real dollars must not count against caps twice: if both rows
    // accrued, reverse the duplicate's accrual and keep the canonical one.
    const [targetAccrual, flaggedAccrual] = await Promise.all([
      tx.capAccrual.findUnique({ where: { sourceKey: `purchase:${target.id}` } }),
      tx.capAccrual.findUnique({ where: { sourceKey: `purchase:${flagged.id}` } }),
    ]);
    if (targetAccrual && flaggedAccrual) {
      await reverseCapAccrual(tx, `purchase:${flagged.id}`);
    }

    await tx.purchase.updateMany({
      where: { userId, possibleDuplicateOfId: flagged.id },
      data: { possibleDuplicateOfId: target.id },
    });
    await tx.purchase.delete({ where: { id: flagged.id } });
    return target.id;
  });

  if (!targetId) return { ok: false as const, error: "not mergeable" };
  revalidatePath("/purchases");
  redirect(`/purchases/${targetId}`);
}

// User confirmed they are different purchases: clear the flag.
export async function keepSeparatePurchase(purchaseIdRaw: unknown) {
  const userId = await requireUserId();
  const parsed = idInput.safeParse(purchaseIdRaw);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };

  await prisma.$transaction(async (tx) => {
    const flagged = await tx.purchase.findFirst({
      where: { id: parsed.data, userId, possibleDuplicateOfId: { not: null } },
      select: { id: true, possibleDuplicateOfId: true },
    });
    if (!flagged?.possibleDuplicateOfId) return;

    const pair = orderedPurchasePair(flagged.id, flagged.possibleDuplicateOfId);
    await tx.purchaseDuplicateDismissal.upsert({
      where: {
        userId_purchaseLowId_purchaseHighId: { userId, ...pair },
      },
      create: { userId, ...pair },
      update: {},
    });
    await tx.purchase.updateMany({
      where: {
        id: flagged.id,
        userId,
        possibleDuplicateOfId: flagged.possibleDuplicateOfId,
      },
      data: { possibleDuplicateOfId: null },
    });
  });
  revalidatePath(`/purchases/${parsed.data}`);
  revalidatePath("/purchases");
  return { ok: true as const };
}

// User initiated return for purchase
export async function createReturnForPurchase(formData: FormData) {
  const userId = await requireUserId();
  const purchaseIdRaw = formData.get("purchaseId");
  const parsed = idInput.safeParse(purchaseIdRaw);
  if (!parsed.success) return { ok: false as const, error: "Invalid purchase ID" };

  const purchase = await prisma.purchase.findFirst({
    where: { id: parsed.data, userId },
  });
  if (!purchase) return { ok: false as const, error: "Purchase not found" };

  const existingReturn = await prisma.returnItem.findFirst({
    where: { purchaseId: purchase.id, userId },
  });
  if (existingReturn) return { ok: false as const, error: "A return already exists for this purchase" };

  const purchaseDate = new Date(purchase.purchasedAt);
  const returnBy = new Date(purchaseDate);
  returnBy.setUTCDate(returnBy.getUTCDate() + 30);

  const createdReturn = await prisma.returnItem.create({
    data: {
      userId,
      purchaseId: purchase.id,
      store: purchase.merchant,
      itemNote: null,
      amountCents: purchase.totalCents ?? null,
      currency: purchase.currency,
      purchaseDate,
      returnWindowDays: 30,
      returnBy,
      dropoffDate: null,
      refundedDate: null,
      trackingNumber: null,
      carrier: null,
      deliveredAt: null,
      refundExpectedAt: null,
      refundSlaDays: 14,
      refundType: "ORIGINAL",
      refundAmountCents: null,
    },
  });

  const { scheduleReturnDeadlineSoon } = await import("@/lib/domain/notifications/eventNotificationScheduler");
  await scheduleReturnDeadlineSoon({
    userId,
    returnId: createdReturn.id,
    store: createdReturn.store,
    itemNote: createdReturn.itemNote,
    returnBy: createdReturn.returnBy,
    amountCents: createdReturn.amountCents,
    currency: createdReturn.currency,
    status: createdReturn.status,
  });

  revalidatePath("/returns");
  revalidatePath(`/purchases/${purchase.id}`);
  redirect("/returns");
}
