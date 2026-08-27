import { prisma } from "@/lib/prisma";
import { applyCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import { walletAmountMinor } from "./amount";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";
import { normalizeCurrencyCode } from "@/lib/utils/currency";
import { resolveCategory, shouldAutoApply } from "@/lib/domain/merchants/resolveCategory";

type WalletEventForNormalization = Awaited<ReturnType<typeof prisma.walletEvent.findFirst>>;
const STALE_PROCESSING_MS = 5 * 60 * 1000;

function capturedMissingFields(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((field): field is string => typeof field === "string")
    : [];
}

async function processClaimedWalletEvent(event: NonNullable<WalletEventForNormalization>): Promise<boolean> {
  const merchantObservation = event.merchantRaw ?? event.transactionNameRaw ?? event.correctedMerchant;
  const amount = event.correctedAmount ?? event.amountRaw;
  const currency = normalizeCurrencyCode(event.correctedCurrency ?? event.currencyRaw);
  const blockingMissingFields = [
    ...(!merchantObservation ? ["merchantRaw", "transactionNameRaw"] : []),
    ...(amount == null ? ["amountRaw"] : []),
    ...(currency == null ? ["currencyRaw"] : []),
  ];

  if (blockingMissingFields.length > 0) {
    await prisma.walletEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: "INCOMPLETE",
        // Keep the capture-time diagnostics as evidence even after the row is
        // later recovered; append only newly discovered blockers.
        missingFields: [...new Set([...capturedMissingFields(event.missingFields), ...blockingMissingFields])],
      },
    });
    return false;
  }
  // The blocking check above establishes these effective values. Naming the
  // narrowed forms keeps every downstream write explicitly non-null.
  const merchantKey = merchantObservation!;
  const normalizedAmount = amount!;
  const normalizedCurrency = currency!;

  let merchantAlias = await prisma.merchantAlias.findUnique({
    where: { rawString: merchantKey },
  });
  if (!merchantAlias) {
    try {
      merchantAlias = await prisma.merchantAlias.create({
        data: { rawString: merchantKey, normalizedName: merchantKey.trim() },
      });
    } catch {
      merchantAlias = await prisma.merchantAlias.findUnique({
        where: { rawString: merchantKey },
      });
    }
  }
  const normalizedMerchant = event.correctedMerchant?.trim() || merchantAlias?.normalizedName;

  // The cold-start resolver. A curated alias still wins — it is tier 2 and
  // nothing below it can outrank an owner's decision — but a merchant nobody
  // has ever categorized now arrives categorized instead of landing in the
  // uncategorized pile and waiting for someone to notice it.
  //
  // Only `certain` and `high` are written. A weaker reading (a restaurant-only
  // processor on an unrecognized name) is left unwritten on purpose: the row
  // stays uncategorized and /purchases offers it as a one-tap suggestion, so a
  // guess never enters the spine wearing the same clothes as a fact.
  const resolution = resolveCategory({
    merchantRaw: merchantKey,
    aliasCategory: merchantAlias?.category,
  });
  const resolvedCategory = shouldAutoApply(resolution) ? resolution.category : null;
  const resolvedCategorySource = resolvedCategory ? resolution.source : null;

  const primaryCardAlias = event.cardRaw
    ? await prisma.cardAlias.findUnique({
        where: { userId_rawString: { userId: event.userId, rawString: event.cardRaw } },
      })
    : null;
  // A genuinely distinct payment-method value is only a secondary signal.
  // It must not replace cardRaw, but it can rescue resolution when cardRaw is
  // present and unknown (the common null-coalescing form could not do that).
  const cardAlias = primaryCardAlias ?? (event.paymentMethodRaw && event.paymentMethodRaw !== event.cardRaw
    ? await prisma.cardAlias.findUnique({
        where: { userId_rawString: { userId: event.userId, rawString: event.paymentMethodRaw } },
      })
    : null);
  // A recovery choice is explicit owner input and takes precedence over the
  // aliases inferred from raw Wallet labels. The action that writes it checks
  // ownership first; raw labels and payload evidence remain untouched.
  const resolvedCardId = event.correctedCardId ?? cardAlias?.cardId ?? null;

  if (!merchantAlias || !normalizedMerchant) {
    await prisma.walletEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: "INCOMPLETE",
        missingFields: [...new Set([...capturedMissingFields(event.missingFields), "merchantResolution"])],
      },
    });
    return false;
  }

  await prisma.$transaction(async (tx) => {
    const amountMinor = walletAmountMinor(normalizedAmount);
    const eventCurrency = normalizedCurrency;
    const latestEvent = await tx.walletEvent.findUnique({
      where: { id: event.id },
      select: { purchaseId: true },
    });
    let spine = latestEvent?.purchaseId
      ? await tx.purchase.findFirst({ where: { id: latestEvent.purchaseId, userId: event.userId } })
      : await tx.purchase.findFirst({
          where: { userId: event.userId, source: "WALLET", sourceEventId: event.eventId },
        });

    if (!spine) {
      const match = amountMinor != null
        ? await findMatchingPurchase(tx, {
            userId: event.userId,
            amountMinor,
            observedAt: event.capturedAt,
            currency: eventCurrency,
            merchantCandidates: [normalizedMerchant, merchantKey],
            incomingSource: "WALLET",
          })
        : null;

      if (match?.confidence === "exact") {
        spine = await tx.purchase.update({
          where: { id: match.purchase.id },
          data: {
            purchasedAt: event.capturedAt,
            paymentMethod: match.purchase.paymentMethod ?? resolvedCardId ?? undefined,
            category: match.purchase.category ?? resolvedCategory ?? undefined,
            categorySource: match.purchase.category ? undefined : resolvedCategorySource ?? undefined,
            currency: match.purchase.currency ?? eventCurrency,
          },
        });
      } else {
        spine = await tx.purchase.create({
          data: {
            userId: event.userId,
            source: "WALLET",
            sourceEventId: event.eventId,
            merchant: normalizedMerchant,
            totalCents: amountMinor,
            currency: eventCurrency,
            purchasedAt: event.capturedAt,
            paymentMethod: resolvedCardId ?? undefined,
            category: resolvedCategory,
            categorySource: resolvedCategorySource,
            possibleDuplicateOfId: match?.purchase.id ?? null,
          }
        });
      }
    }

    const ownerState = await ensureOwnerStateRecord(tx, event.userId);
    if (ownerState && resolvedCardId && normalizeCurrencyCode(spine.currency) === "CAD") {
      await applyCapAccrual(tx, {
        sourceKey: `purchase:${spine.id}`,
        userId: event.userId,
        cardId: resolvedCardId,
        category: spine.category,
        merchantBrand: normalizedMerchant,
        amountMinor: amountMinor!,
        currency: spine.currency,
        occurredAt: event.capturedAt,
      }, ownerState.stateData);
    }

    await tx.walletEvent.update({
      where: { id: event.id },
      data: {
        processingStatus: "NORMALIZED",
        financialState: "NORMALIZED",
        merchantNormalized: normalizedMerchant,
        resolvedCardId,
        purchaseId: spine.id,
      },
    });
  });
  return true;
}

async function claimAndProcessWalletEvent(event: NonNullable<WalletEventForNormalization>): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claimed = await prisma.walletEvent.updateMany({
    where: {
      id: event.id,
      OR: [
        { processingStatus: "OBSERVED" },
        { processingStatus: "PROCESSING", updatedAt: { lt: staleBefore } },
      ],
    },
    data: { processingStatus: "PROCESSING" },
  });
  if (claimed.count !== 1) return false;

  try {
    return await processClaimedWalletEvent(event);
  } catch (error) {
    // A transient failure must remain retryable. The conditional update avoids
    // undoing a terminal transition if the event finished elsewhere.
    await prisma.walletEvent.updateMany({
      where: { id: event.id, processingStatus: "PROCESSING" },
      data: { processingStatus: "OBSERVED" },
    });
    throw error;
  }
}

/** Request-time path: processes only the event that was just accepted. */
export async function processWalletEvent(eventId: string) {
  const event = await prisma.walletEvent.findUnique({ where: { eventId } });
  if (!event || event.processingStatus !== "OBSERVED") return false;
  return claimAndProcessWalletEvent(event);
}

/** Repair path: bounded global batch; stale claims are safe to recover after a worker crash. */
export async function processWalletEvents() {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const events = await prisma.walletEvent.findMany({
    where: {
      OR: [
        { processingStatus: "OBSERVED" },
        { processingStatus: "PROCESSING", updatedAt: { lt: staleBefore } },
      ],
    },
    take: 100,
  });

  let processed = 0;
  for (const event of events) {
    if (await claimAndProcessWalletEvent(event)) processed++;
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
