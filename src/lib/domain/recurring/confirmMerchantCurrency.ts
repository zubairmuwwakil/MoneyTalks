import type { Prisma, PrismaClient } from "@prisma/client";

type ConfirmationInput = {
  userId: string;
  merchantCanonicalId: string;
  currency: string;
};

/**
 * Apply the learned fact inside an existing transaction. This is exported so
 * owner-facing mutations can keep their own audit write atomic with learning.
 */
export async function applyMerchantCurrencyConfirmation(
  tx: Prisma.TransactionClient,
  input: ConfirmationInput,
  options: { replaceLearnedPurchases?: boolean } = {},
): Promise<{ affectedPurchases: number }> {
  await tx.merchantCurrencyConfirmation.upsert({
    where: {
      userId_merchantCanonicalId: {
        userId: input.userId,
        merchantCanonicalId: input.merchantCanonicalId,
      },
    },
    create: input,
    update: { currency: input.currency },
  });
  // Keep provenance in the write predicate itself. A separate select followed
  // by an ID-only update could trample stronger evidence committed in between.
  const purchases = await tx.purchase.updateManyAndReturn({
    where: {
      userId: input.userId,
      merchant: input.merchantCanonicalId,
      OR: [
        { currencySource: null },
        { currencySource: "none" },
        ...(options.replaceLearnedPurchases
          ? [{ currencySource: "ownerConfirmedForMerchant" }]
          : []),
      ],
    },
    data: { currency: input.currency, currencySource: "ownerConfirmedForMerchant" },
    select: { id: true },
  });
  const purchaseIds = purchases.map(({ id }) => id);
  if (purchaseIds.length > 0) {
    // Detection rows are re-derived state. Removing only reviewable rows
    // touched by this answer prevents an old learned identity from surviving
    // beside its replacement; confirmed rows remain protected.
    await tx.recurringObligation.deleteMany({
      where: {
        userId: input.userId,
        merchantCanonicalId: input.merchantCanonicalId,
        origin: "DETECTED",
        needsReview: true,
        evidence: { some: { purchaseId: { in: purchaseIds } } },
      },
    });
  }
  return { affectedPurchases: purchaseIds.length };
}

/**
 * Persist an owner's merchant-level currency answer. By default only rows with
 * no prior provenance are re-resolved. The obligation correction path can also
 * replace purchases derived from an older value of this same learned fact.
 */
export async function confirmMerchantCurrency(
  db: PrismaClient,
  input: ConfirmationInput,
  options?: { replaceLearnedPurchases?: boolean },
): Promise<{ affectedPurchases: number }> {
  return db.$transaction((tx) => applyMerchantCurrencyConfirmation(tx, input, options));
}
