import { prisma } from "@/lib/prisma";
import { applyCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import { walletAmountMinor } from "./amount";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

export async function processWalletEvents() {
  const events = await prisma.walletEvent.findMany({
    where: { processingStatus: "OBSERVED" },
    take: 100,
  });

  let processed = 0;
  for (const event of events) {
    if (!event.merchantRaw) continue;

    let merchantAlias = await prisma.merchantAlias.findUnique({
      where: { rawString: event.merchantRaw },
    });
    if (!merchantAlias) {
      // First sighting anywhere: seed the global alias with the raw string
      // itself (Apple's merchant field is already a display name) and no
      // category — categorization stays deliberately unresolved, but the
      // event can promote instead of sitting OBSERVED forever.
      try {
        merchantAlias = await prisma.merchantAlias.create({
          data: { rawString: event.merchantRaw, normalizedName: event.merchantRaw.trim() },
        });
      } catch {
        // Concurrent run created it (rawString is unique) — use theirs.
        merchantAlias = await prisma.merchantAlias.findUnique({
          where: { rawString: event.merchantRaw },
        });
      }
    }

    const cardAlias = event.cardRaw
      ? await prisma.cardAlias.findUnique({
          where: { userId_rawString: { userId: event.userId, rawString: event.cardRaw } },
        })
      : null;

    if (merchantAlias) {
      // Normalize & promote to spine
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
                merchantCandidates: [merchantAlias.normalizedName, event.merchantRaw].filter(
                  (m): m is string => !!m,
                ),
                incomingSource: "WALLET",
              })
            : null;

          if (match?.confidence === "exact") {
            // Same real purchase, first seen by another source. Enrich the
            // canonical row instead of duplicating; the tap is the
            // authoritative instant for purchasedAt.
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
        if (
          ownerState &&
          event.amountRaw != null &&
          cardAlias &&
          normalizeCurrencyCode(spine.currency) === "CAD"
        ) {
          // Keyed on the canonical purchase: whichever source resolves first
          // accrues; CapAccrual.sourceKey uniqueness blocks a second source
          // from double-counting the same real dollars.
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
