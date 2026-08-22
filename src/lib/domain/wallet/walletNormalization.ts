import { prisma } from "@/lib/prisma";
import { applyCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import { walletAmountMinor } from "./amount";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

type WalletEventForNormalization = Awaited<ReturnType<typeof prisma.walletEvent.findFirst>>;

async function processObservedWalletEvent(event: NonNullable<WalletEventForNormalization>): Promise<boolean> {
  const merchantObservation = event.merchantRaw ?? event.transactionNameRaw;
  if (!merchantObservation) {
    await prisma.walletEvent.update({
      where: { id: event.id },
      data: { processingStatus: "INCOMPLETE", missingFields: ["merchantRaw", "transactionNameRaw"] },
    });
    return false;
  }

  let merchantAlias = await prisma.merchantAlias.findUnique({
    where: { rawString: merchantObservation },
  });
  if (!merchantAlias) {
    try {
      merchantAlias = await prisma.merchantAlias.create({
        data: { rawString: merchantObservation, normalizedName: merchantObservation.trim() },
      });
    } catch {
      merchantAlias = await prisma.merchantAlias.findUnique({
        where: { rawString: merchantObservation },
      });
    }
  }

  const cardObservation = event.cardRaw ?? event.paymentMethodRaw;
  const cardAlias = cardObservation
    ? await prisma.cardAlias.findUnique({
        where: { userId_rawString: { userId: event.userId, rawString: cardObservation } },
      })
    : null;

  if (!merchantAlias) {
    await prisma.walletEvent.update({
      where: { id: event.id },
      data: { processingStatus: "INCOMPLETE", missingFields: ["merchantResolution"] },
    });
    return false;
  }

  await prisma.$transaction(async (tx) => {
    const amountMinor = walletAmountMinor(event.amountRaw);
    const eventCurrency = normalizeCurrencyCode(event.currencyRaw);
    let spine = await tx.purchase.findFirst({
      where: { userId: event.userId, source: "WALLET", sourceEventId: event.eventId }
    });

    if (!spine) {
      const match = amountMinor != null
        ? await findMatchingPurchase(tx, {
            userId: event.userId,
            amountMinor,
            observedAt: event.capturedAt,
            currency: event.currencyRaw,
            merchantCandidates: [merchantAlias.normalizedName, merchantObservation],
            incomingSource: "WALLET",
          })
        : null;

      if (match?.confidence === "exact") {
        spine = await tx.purchase.update({
          where: { id: match.purchase.id },
          data: {
            purchasedAt: event.capturedAt,
            paymentMethod: match.purchase.paymentMethod ?? cardAlias?.cardId ?? undefined,
            category: match.purchase.category ?? merchantAlias.category ?? undefined,
            currency: match.purchase.currency ?? eventCurrency,
          },
        });
      } else {
        spine = await tx.purchase.create({
          data: {
            userId: event.userId,
            source: "WALLET",
            sourceEventId: event.eventId,
            merchant: merchantAlias.normalizedName,
            totalCents: amountMinor,
            currency: eventCurrency,
            purchasedAt: event.capturedAt,
            paymentMethod: cardAlias?.cardId || undefined,
            category: merchantAlias.category,
            possibleDuplicateOfId: match?.purchase.id ?? null,
          }
        });
      }
    }

    const ownerState = await ensureOwnerStateRecord(tx, event.userId);
    if (ownerState && event.amountRaw != null && cardAlias && normalizeCurrencyCode(spine.currency) === "CAD") {
      await applyCapAccrual(tx, {
        sourceKey: `purchase:${spine.id}`,
        userId: event.userId,
        cardId: cardAlias.cardId,
        category: merchantAlias.category,
        merchantBrand: merchantAlias.normalizedName,
        amountMinor: walletAmountMinor(event.amountRaw)!,
        currency: spine.currency,
        occurredAt: event.capturedAt,
      }, ownerState.stateData);
    }

    await tx.walletEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: "NORMALIZED",
        merchantNormalized: merchantAlias.normalizedName,
        resolvedCardId: cardAlias?.cardId ?? null,
        purchaseId: spine.id,
      },
    });
  });
  return true;
}

/** Request-time path: processes only the event that was just accepted. */
export async function processWalletEvent(eventId: string) {
  const event = await prisma.walletEvent.findUnique({ where: { eventId } });
  if (!event || event.processingStatus !== "OBSERVED") return false;
  return processObservedWalletEvent(event);
}

/** Repair path: bounded global batch, with every OBSERVED row leaving OBSERVED. */
export async function processWalletEvents() {
  const events = await prisma.walletEvent.findMany({
    where: { processingStatus: "OBSERVED" },
    take: 100,
  });

  let processed = 0;
  for (const event of events) {
    if (await processObservedWalletEvent(event)) processed++;
  }

  // Reversed is terminal. Its original period and amount come from CapAccrual,
  // so the current owner state cannot accidentally move the decrement.
  const reversedEvents = await prisma.walletEvent.findMany({
    where: { processingStatus: "REVERSED" },
    take: 100,
  });
  for (const event of reversedEvents) {
    await prisma.$transaction(async (tx) => {
      // Canonical key first; pre-merge history accrued under the legacy key.
      const reversed = event.purchaseId
        ? await reverseCapAccrual(tx, `purchase:${event.purchaseId}`)
        : false;
      if (!reversed) await reverseCapAccrual(tx, `wallet:${event.id}`);
    });
  }

  return processed;
}
