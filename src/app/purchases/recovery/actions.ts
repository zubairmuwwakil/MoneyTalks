"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { processWalletEvent } from "@/lib/domain/wallet/walletNormalization";

export type RecoverCaptureState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Partial<Record<"merchant" | "amount" | "currency" | "cardId", string>>;
};

const recoveryInput = z.object({
  eventId: z.string().min(1),
  merchant: z.string().trim().min(1, "Enter a merchant").max(180, "Merchant is too long"),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,11}(?:\.\d{1,4})?$/, "Enter a positive amount with up to 4 decimal places"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Enter a 3-letter currency code"),
  cardId: z.string().trim().max(100).optional().transform((value) => value || null),
});

function validationState(error: z.ZodError): RecoverCaptureState {
  const fieldErrors: NonNullable<RecoverCaptureState["fieldErrors"]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field === "merchant" || field === "amount" || field === "currency" || field === "cardId") && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }
  return {
    ok: false,
    message: "Check the highlighted fields.",
    fieldErrors,
  };
}

export async function recoverIncompleteCapture(
  _previousState: RecoverCaptureState,
  formData: FormData,
): Promise<RecoverCaptureState> {
  const userId = await requireUserId();
  const parsed = recoveryInput.safeParse({
    eventId: formData.get("eventId"),
    merchant: formData.get("merchant"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    cardId: formData.get("cardId"),
  });
  if (!parsed.success) return validationState(parsed.error);

  const amount = new Prisma.Decimal(parsed.data.amount);
  if (!amount.isPositive()) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: { amount: "Amount must be greater than zero" },
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const event = await tx.walletEvent.findFirst({
      where: { id: parsed.data.eventId, userId },
      select: {
        id: true,
        eventId: true,
        processingStatus: true,
        purchaseId: true,
        merchantRaw: true,
        transactionNameRaw: true,
        cardRaw: true,
        paymentMethodRaw: true,
      },
    });
    if (!event) return { kind: "not-found" as const };
    if (event.processingStatus !== "INCOMPLETE") {
      return { kind: "already-recovered" as const };
    }

    if (parsed.data.cardId) {
      const ownsCard = await tx.creditCard.findFirst({
        where: { userId, contractCardId: parsed.data.cardId },
        select: { id: true },
      });
      if (!ownsCard) return { kind: "unknown-card" as const };
    }

    const merchantKey = event.merchantRaw ?? event.transactionNameRaw ?? parsed.data.merchant;
    await tx.merchantAlias.upsert({
      where: { rawString: merchantKey },
      create: { rawString: merchantKey, normalizedName: parsed.data.merchant },
      update: { normalizedName: parsed.data.merchant },
    });

    const cardKey = event.cardRaw ?? event.paymentMethodRaw;
    if (parsed.data.cardId && cardKey) {
      await tx.cardAlias.upsert({
        where: { userId_rawString: { userId, rawString: cardKey } },
        create: { userId, rawString: cardKey, cardId: parsed.data.cardId },
        update: { cardId: parsed.data.cardId },
      });
    }

    const updated = await tx.walletEvent.updateMany({
      where: { id: event.id, userId, processingStatus: "INCOMPLETE" },
      data: {
        correctedMerchant: parsed.data.merchant,
        correctedAmount: amount,
        correctedCurrency: parsed.data.currency,
        correctedCardId: parsed.data.cardId,
        recoveredAt: new Date(),
        processingStatus: "OBSERVED",
      },
    });
    return updated.count === 1
      ? { kind: "ready" as const, eventId: event.eventId }
      : { kind: "already-recovered" as const };
  });

  if (outcome.kind === "not-found") {
    return { ok: false, message: "Capture not found." };
  }
  if (outcome.kind === "unknown-card") {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: { cardId: "Choose one of your saved cards" } };
  }
  if (outcome.kind === "already-recovered") {
    revalidatePath("/purchases/recovery");
    revalidatePath("/purchases");
    return { ok: true, message: "This capture was already recovered." };
  }

  try {
    const normalized = await processWalletEvent(outcome.eventId);
    if (!normalized) {
      return { ok: false, message: "Corrections were saved, but this capture still needs attention." };
    }
  } catch (error) {
    console.error("Error normalizing recovered Wallet event", error);
    return { ok: false, message: "Corrections were saved. Processing will retry automatically." };
  } finally {
    revalidatePath("/purchases/recovery");
    revalidatePath("/purchases");
    revalidatePath("/settings/automation");
  }

  return { ok: true, message: "Purchase recovered." };
}
