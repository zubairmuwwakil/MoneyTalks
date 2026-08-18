"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { reverseCapAccrual } from "@/lib/spine/cap-usage";
import { orderedPurchasePair } from "@/lib/domain/spine/purchaseMerge";

const idInput = z.string().min(1);

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
