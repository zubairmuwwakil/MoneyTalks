import type { PrismaClient } from "@prisma/client";

/**
 * Persist an owner's merchant-level currency answer and re-resolve only rows
 * whose currency was absent or came from the same learned tier. Message-local,
 * wallet, and per-purchase owner evidence remain stronger and untouched.
 */
export async function confirmMerchantCurrency(
  db: PrismaClient,
  input: {
    userId: string;
    merchantCanonicalId: string;
    currency: string;
  },
): Promise<{ affectedPurchases: number }> {
  const affectedPurchases = await db.$transaction(async (tx) => {
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
    const purchases = await tx.purchase.findMany({
      where: {
        userId: input.userId,
        merchant: input.merchantCanonicalId,
        OR: [
          { currency: null },
          { currencySource: "ownerConfirmedForMerchant" },
        ],
      },
      select: { id: true },
    });
    const purchaseIds = purchases.map(({ id }) => id);
    if (purchaseIds.length > 0) {
      await tx.purchase.updateMany({
        where: { id: { in: purchaseIds }, userId: input.userId },
        data: { currency: input.currency, currencySource: "ownerConfirmedForMerchant" },
      });
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
    return purchaseIds.length;
  });

  return { affectedPurchases };
}
