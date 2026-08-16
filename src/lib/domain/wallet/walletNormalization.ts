import { prisma } from "@/lib/prisma";

export async function processWalletEvents() {
  const events = await prisma.walletEvent.findMany({
    where: { processingStatus: "OBSERVED" },
    take: 100,
  });

  let processed = 0;
  for (const event of events) {
    if (!event.merchantRaw) continue;

    const merchantAlias = await prisma.merchantAlias.findUnique({
      where: { rawString: event.merchantRaw },
    });

    const cardAlias = event.cardRaw 
      ? await prisma.cardAlias.findUnique({ where: { rawString: event.cardRaw } })
      : null;

    if (merchantAlias && (cardAlias || !event.cardRaw)) {
      // Normalize & promote to spine
      await prisma.$transaction(async (tx) => {
        const existingSpine = await tx.purchase.findFirst({
          where: { source: "WALLET", sourceEventId: event.eventId }
        });

        if (!existingSpine) {
          await tx.purchase.create({
            data: {
              userId: event.userId,
              source: "WALLET",
              sourceEventId: event.eventId,
              merchant: merchantAlias.normalizedName,
              totalCents: event.amountRaw != null ? Math.round(event.amountRaw * 100) : null,
              currency: event.currencyRaw || "CAD",
              purchasedAt: event.capturedAt,
              paymentMethod: cardAlias?.cardId || undefined,
            }
          });
        }

        await tx.walletEvent.update({
          where: { id: event.id },
          data: { processingStatus: "NORMALIZED" },
        });
      });
      processed++;
    }
  }

  return processed;
}
