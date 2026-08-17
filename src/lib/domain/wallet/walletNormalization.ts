import { prisma } from "@/lib/prisma";
import { applyCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";

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
              category: merchantAlias.category,
            }
          });
        }

        const ownerState = await tx.ownerStateRecord.findUnique({ where: { userId: event.userId } });
        if (ownerState && event.amountRaw != null && cardAlias) {
          await applyCapAccrual(tx, {
            sourceKey: `wallet:${event.id}`,
            userId: event.userId,
            cardId: cardAlias.cardId,
            category: merchantAlias.category,
            merchantBrand: merchantAlias.normalizedName,
            amountMinor: Math.round(event.amountRaw * 100),
            currency: event.currencyRaw || "CAD",
            occurredAt: event.capturedAt,
          }, ownerState.stateData);
        }

        await tx.walletEvent.update({
          where: { id: event.id },
          data: { processingStatus: "NORMALIZED" },
        });
      });
      processed++;
    }
  }

  // Reversed is terminal. Its original period and amount come from CapAccrual,
  // so the current owner state cannot accidentally move the decrement.
  const reversedEvents = await prisma.walletEvent.findMany({
    where: { processingStatus: "REVERSED" },
    take: 100,
  });
  for (const event of reversedEvents) {
    await prisma.$transaction((tx) => reverseCapAccrual(tx, `wallet:${event.id}`));
  }

  return processed;
}
