"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { cardCatalogue, publishedCards } from "@/lib/contracts/cardCatalogue";

const mapInput = z.object({
  rawString: z.string().min(1),
  contractCardId: z.string().min(1),
});

const linkSavedCardInput = z.object({
  cardId: z.string().min(1),
  contractCardId: z.string().min(1).max(100),
});

/**
 * Confirms which published PickMe contract a personal CreditCard row represents. This is
 * purposefully an explicit user choice: names such as "Momentum Visa Infinite" are not enough
 * to safely infer a product variant and its caps/earn rules.
 */
export async function linkSavedCardToContract(input: { cardId: string; contractCardId: string }) {
  const userId = await requireUserId();
  const parsed = linkSavedCardInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  // publishedCards, not the whole corpus: a draft is not a link target.
  if (!publishedCards().some((card) => card.cardId === parsed.data.contractCardId)) {
    return { ok: false as const, error: "unknown catalogue card" };
  }

  const updated = await prisma.creditCard.updateMany({
    where: { id: parsed.data.cardId, userId },
    data: { contractCardId: parsed.data.contractCardId },
  });
  if (updated.count !== 1) return { ok: false as const, error: "card not found" };

  revalidatePath("/settings/wallet");
  revalidatePath("/cards/reconcile");
  return { ok: true as const };
}

// Maps a raw Apple Pay card string ("American Express Cobalt") to one of the
// user's cards, then backfills every captured event that carried that string.
// Un-promoted events get picked up by the next normalization run.
export async function mapWalletCard(input: { rawString: string; contractCardId: string }) {
  const userId = await requireUserId();
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  const { rawString, contractCardId } = parsed.data;

  const ownsCard = await prisma.creditCard.findFirst({
    where: { userId, contractCardId },
    select: { id: true },
  });
  if (!ownsCard) return { ok: false as const, error: "unknown card" };

  await prisma.cardAlias.upsert({
    where: { userId_rawString: { userId, rawString } },
    create: { userId, rawString, cardId: contractCardId },
    update: { cardId: contractCardId },
  });

  await prisma.walletEvent.updateMany({
    where: { userId, cardRaw: rawString },
    data: { resolvedCardId: contractCardId },
  });

  // Backfill purchases that promoted without a paymentMethod (normalization
  // now proceeds even when the card alias is missing).
  const enrichableEvents = await prisma.walletEvent.findMany({
    where: { userId, cardRaw: rawString, purchaseId: { not: null } },
    select: { purchaseId: true },
  });
  const purchaseIds = [...new Set(enrichableEvents.map((e) => e.purchaseId!))];
  if (purchaseIds.length > 0) {
    await prisma.purchase.updateMany({
      where: { id: { in: purchaseIds }, paymentMethod: null },
      data: { paymentMethod: contractCardId },
    });
  }

  // Trigger normalization so any still-OBSERVED events with this card can
  // promote now that the alias exists, and cap accrual can run for events
  // that were promoted without it.
  try {
    const { processWalletEvents } = await import("@/lib/domain/wallet/walletNormalization");
    await processWalletEvents();
  } catch (e) {
    console.error("Error processing wallet events after card mapping", e);
  }

  revalidatePath("/settings/wallet");
  revalidatePath("/purchases");
  return { ok: true as const };
}

// Automatically creates a CreditCard record for the user from the card catalogue
// (if they don't already have one) AND maps the raw Apple Pay string to it.
export async function addCardAndMapWallet(input: { rawString: string; contractCardId: string }) {
  const userId = await requireUserId();
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "invalid input" };
  const { rawString, contractCardId } = parsed.data;

  const catCard = cardCatalogue.cards.find((c) => c.cardId === contractCardId);
  if (!catCard) return { ok: false as const, error: "unknown catalogue card" };

  const existingCard = await prisma.creditCard.findFirst({
    where: { userId, contractCardId },
    select: { id: true },
  });

  if (!existingCard) {
    let nickname = catCard.officialName;
    const nicknameConflict = await prisma.creditCard.findUnique({
      where: { userId_nickname: { userId, nickname } },
      select: { id: true },
    });
    if (nicknameConflict) {
      nickname = `${catCard.officialName} (${rawString.slice(-4)})`;
    }

    await prisma.creditCard.create({
      data: {
        userId,
        nickname,
        issuer: catCard.issuer,
        network: catCard.network,
        contractCardId: catCard.cardId,
        currency: cardCatalogue.currency || "CAD",
      },
    });
  }

  await prisma.cardAlias.upsert({
    where: { userId_rawString: { userId, rawString } },
    create: { userId, rawString, cardId: contractCardId },
    update: { cardId: contractCardId },
  });

  await prisma.walletEvent.updateMany({
    where: { userId, cardRaw: rawString },
    data: { resolvedCardId: contractCardId },
  });

  const enrichableEvents = await prisma.walletEvent.findMany({
    where: { userId, cardRaw: rawString, purchaseId: { not: null } },
    select: { purchaseId: true },
  });
  const purchaseIds = [...new Set(enrichableEvents.map((e) => e.purchaseId!))];
  if (purchaseIds.length > 0) {
    await prisma.purchase.updateMany({
      where: { id: { in: purchaseIds }, paymentMethod: null },
      data: { paymentMethod: contractCardId },
    });
  }

  try {
    const { processWalletEvents } = await import("@/lib/domain/wallet/walletNormalization");
    await processWalletEvents();
  } catch (e) {
    console.error("Error processing wallet events after card creation & mapping", e);
  }

  revalidatePath("/cards");
  revalidatePath("/settings/wallet");
  revalidatePath("/purchases");
  return { ok: true as const };
}


