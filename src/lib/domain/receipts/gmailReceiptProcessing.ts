import {
  Prisma,
  type EmailTransaction,
  type PrismaClient,
} from "@prisma/client";

import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";
import { applyCapAccrual, removeCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import type { RawGmailMessage } from "@/lib/services/gmailScanSource";
import { resolveEmailMerchant } from "./emailMerchant";
import {
  parsePurchaseFromRawGmailMessage,
  type Purchase as ParsedPurchase,
} from "./gmailPurchaseParser";
import { hasPurchaseEvidence } from "./receiptEvidence";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

export type GmailMessageProcessingMode = "scan" | "reprocess";
export type GmailTransactionAction = "created" | "updated" | "skipped";
export type GmailPurchaseAction = "none" | "created" | "updated" | "linked" | "deleted" | "unlinked";

export type GmailMessageProcessingResult = {
  transaction: EmailTransaction;
  parsedPurchase: ParsedPurchase;
  parserError: string | null;
  transactionAction: GmailTransactionAction;
  purchaseAction: GmailPurchaseAction;
};

function failedParse(message: RawGmailMessage): ParsedPurchase {
  return {
    messageId: message.messageId,
    merchant: "Parse Failed",
    rawSource: "text",
    fromEmail: message.from ?? undefined,
    subject: message.subject ?? undefined,
    purchasedAt: message.internalDate ?? undefined,
    orderId: undefined,
    totalCents: undefined,
    currency: undefined,
    items: undefined,
  };
}

function emailTransactionData(
  userId: string,
  message: RawGmailMessage,
  parsed: ParsedPurchase,
  merchant: string,
  parserError: string | null,
) {
  const items = parsed.items === undefined
    ? Prisma.DbNull
    : parsed.items as Prisma.InputJsonValue;

  return {
    userId,
    provider: "GMAIL" as const,
    messageId: message.messageId,
    merchant,
    fromEmail: parsed.fromEmail ?? null,
    subject: parsed.subject ?? null,
    purchasedAt: parsed.purchasedAt ?? message.internalDate ?? null,
    orderId: parsed.orderId ?? null,
    totalCents: parsed.totalCents ?? null,
    currency: normalizeCurrencyCode(parsed.currency),
    items,
    rawSource: parsed.rawSource,
    parserError,
  };
}

type ReceiptTransaction = Prisma.TransactionClient;

async function promotePurchase(
  db: ReceiptTransaction,
  params: {
    userId: string;
    message: RawGmailMessage;
    transaction: EmailTransaction;
  },
): Promise<{ transaction: EmailTransaction; action: GmailPurchaseAction }> {
  const { userId, message } = params;
  let emailTransaction = params.transaction;
  let action: GmailPurchaseAction = "none";

  // A prior canonical link wins, followed by this email's stable source key.
  let purchase = emailTransaction.purchaseId
    ? await db.purchase.findUnique({ where: { id: emailTransaction.purchaseId } })
    : await db.purchase.findUnique({
        where: { userId_sourceEmailId: { userId, sourceEmailId: message.messageId } },
      });

  if (purchase?.source === "GMAIL") {
    // Reprocessing must clear a historical guessed CAD value, but a linked
    // Wallet observation with an explicit code is valid enrichment and wins
    // when the email itself remains ambiguous.
    const walletCurrency = await db.walletEvent.findFirst({
      where: { purchaseId: purchase.id, currencyRaw: { not: null } },
      select: { currencyRaw: true },
      orderBy: { capturedAt: "asc" },
    });
    const canonicalCurrency =
      normalizeCurrencyCode(emailTransaction.currency) ??
      normalizeCurrencyCode(walletCurrency?.currencyRaw);
    purchase = await db.purchase.update({
      where: { id: purchase.id },
      data: {
        merchant: emailTransaction.merchant,
        totalCents: emailTransaction.totalCents ?? null,
        currency: canonicalCurrency,
        purchasedAt: emailTransaction.purchasedAt ?? message.internalDate ?? new Date(),
        orderNumber: emailTransaction.orderId ?? null,
      },
    });
    action = "updated";
  } else if (!purchase) {
    const observedAt = emailTransaction.purchasedAt ?? message.internalDate ?? new Date();
    const match = emailTransaction.totalCents != null
      ? await findMatchingPurchase(db, {
          userId,
          amountMinor: emailTransaction.totalCents,
          observedAt,
          currency: emailTransaction.currency,
          merchantCandidates: [emailTransaction.merchant],
          incomingSource: "GMAIL",
        })
      : null;

    if (match?.confidence === "exact") {
      purchase = await db.purchase.update({
        where: { id: match.purchase.id },
        data: {
          orderNumber: match.purchase.orderNumber ?? emailTransaction.orderId ?? undefined,
          currency: match.purchase.currency ?? normalizeCurrencyCode(emailTransaction.currency),
        },
      });
      action = "linked";
    } else {
      purchase = await db.purchase.create({
        data: {
          userId,
          merchant: emailTransaction.merchant,
          totalCents: emailTransaction.totalCents ?? null,
          currency: normalizeCurrencyCode(emailTransaction.currency),
          purchasedAt: observedAt,
          orderNumber: emailTransaction.orderId ?? null,
          paymentMethod: null,
          source: "GMAIL",
          sourceEmailId: message.messageId,
          possibleDuplicateOfId: match?.purchase.id ?? null,
        },
      });
      action = "created";
    }
  }

  if (emailTransaction.purchaseId !== purchase.id) {
    emailTransaction = await db.emailTransaction.update({
      where: { id: emailTransaction.id },
      data: { purchaseId: purchase.id },
    });
    if (action === "none") action = "linked";
  }

  // Reprocessing can change amount, currency, period, or cap rule. Remove the
  // old projection delta first; a later explicit currency may then accrue the
  // same canonical source key again.
  if (action === "updated") {
    await removeCapAccrual(db, `purchase:${purchase.id}`);
  }

  // Email purchases accrue only after both card and category resolution.
  if (purchase.paymentMethod && purchase.category && purchase.totalCents != null) {
    const ownerState = await ensureOwnerStateRecord(db, userId);
    if (ownerState) {
      await applyCapAccrual(db, {
        sourceKey: `purchase:${purchase.id}`,
        userId,
        cardId: purchase.paymentMethod,
        category: purchase.category,
        merchantBrand: purchase.merchant,
        amountMinor: purchase.totalCents,
        currency: purchase.currency,
        occurredAt: purchase.purchasedAt,
      }, ownerState.stateData);
    }
  }

  const parsedItems = Array.isArray(emailTransaction.items)
    ? emailTransaction.items as Array<{ name?: string; quantity?: number; price?: number }>
    : null;
  const emailOwnsPurchase = purchase.source === "GMAIL" && purchase.sourceEmailId === message.messageId;

  // An owning email's empty item list is meaningful during reprocessing: it
  // clears stale line items. For a cross-source purchase, leave unrelated
  // items alone unless this email actually supplied replacements.
  if (emailOwnsPurchase || parsedItems) {
    await db.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } });
    const items = (parsedItems ?? []).map((item) => ({
      purchaseId: purchase.id,
      title: String(item.name ?? "Item"),
      qty: typeof item.quantity === "number" ? Math.max(1, Math.round(item.quantity)) : null,
      priceCents: typeof item.price === "number" ? Math.round(item.price * 100) : null,
      currency: purchase.currency,
    }));
    if (items.length > 0) await db.purchaseItem.createMany({ data: items });
  }

  const documents = await db.receiptDocument.findMany({
    where: { emailTransactionId: emailTransaction.id },
    select: { storagePath: true, contentType: true },
  });
  if (documents.length > 0) {
    await db.purchaseAttachment.createMany({
      data: documents.map((document) => ({
        purchaseId: purchase.id,
        storageKey: document.storagePath,
        mime: document.contentType ?? null,
        sha256: null,
        sourceEmailId: message.messageId,
      })),
      skipDuplicates: true,
    });
  }

  return { transaction: emailTransaction, action };
}

async function demotePurchase(
  db: ReceiptTransaction,
  params: {
    userId: string;
    messageId: string;
    previousPurchaseId: string | null;
  },
): Promise<GmailPurchaseAction> {
  const purchase = params.previousPurchaseId
    ? await db.purchase.findUnique({
        where: { id: params.previousPurchaseId },
        select: {
          id: true,
          userId: true,
          source: true,
          sourceEmailId: true,
          emailTransactions: { select: { messageId: true }, take: 1 },
          walletEvents: { select: { id: true, eventId: true }, take: 1 },
          statementLines: { select: { id: true }, take: 1 },
        },
      })
    : await db.purchase.findUnique({
        where: {
          userId_sourceEmailId: {
            userId: params.userId,
            sourceEmailId: params.messageId,
          },
        },
        select: {
          id: true,
          userId: true,
          source: true,
          sourceEmailId: true,
          emailTransactions: { select: { messageId: true }, take: 1 },
          walletEvents: { select: { id: true, eventId: true }, take: 1 },
          statementLines: { select: { id: true }, take: 1 },
        },
      });

  if (!purchase || purchase.userId !== params.userId) return "none";

  const hasOtherRawEvidence =
    purchase.emailTransactions.length > 0 ||
    purchase.walletEvents.length > 0 ||
    purchase.statementLines.length > 0;

  // Only a Gmail-origin purchase with no remaining raw observation belongs to
  // this demotion. User return records survive via their on-delete SetNull.
  if (purchase.source === "GMAIL" && !hasOtherRawEvidence) {
    await reverseCapAccrual(db, `purchase:${purchase.id}`);
    await db.purchase.delete({ where: { id: purchase.id } });
    return "deleted";
  }

  // A shared canonical purchase survives, but evidence artifacts contributed
  // solely by this now-invalid email must not remain attached to it.
  await db.purchaseAttachment.deleteMany({
    where: { purchaseId: purchase.id, sourceEmailId: params.messageId },
  });
  if (purchase.emailTransactions.length === 0) {
    // PurchaseItem has no provenance column; email parsing is its only writer.
    // Once no email observation remains, these line items are stale.
    await db.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } });
  }

  // sourceEmailId is a logical provenance link (not a FK). Clear or transfer
  // it when the email that owned it stops qualifying.
  if (purchase.sourceEmailId === params.messageId) {
    const replacementEmail = purchase.emailTransactions[0];
    const replacementWallet = purchase.walletEvents[0];
    const data = replacementEmail
      ? { sourceEmailId: replacementEmail.messageId }
      : replacementWallet && purchase.source === "GMAIL"
        ? { source: "WALLET" as const, sourceEmailId: null, sourceEventId: replacementWallet.eventId }
        : { sourceEmailId: null };
    await db.purchase.update({ where: { id: purchase.id }, data });
  }

  return "unlinked";
}

/**
 * Parse one raw Gmail message and reconcile its EmailTransaction/Purchase
 * projection. Both scan and explicit reprocessing call this function so the
 * evidence boundary cannot drift between endpoints.
 */
export async function processRawGmailMessage(
  db: PrismaClient,
  params: {
    userId: string;
    message: RawGmailMessage;
    mode: GmailMessageProcessingMode;
  },
): Promise<GmailMessageProcessingResult> {
  let parsedPurchase: ParsedPurchase;
  let parserError: string | null = null;

  try {
    parsedPurchase = await parsePurchaseFromRawGmailMessage({
      messageId: params.message.messageId,
      raw: params.message.raw.toString("base64url"),
    });
  } catch (error) {
    parserError = error instanceof Error ? error.message : String(error);
    parsedPurchase = failedParse(params.message);
  }

  const merchant = parserError
    ? parsedPurchase.merchant
    : await resolveEmailMerchant(db, parsedPurchase.merchant);

  return db.$transaction(async (transactionDb) => {
    const existing = await transactionDb.emailTransaction.findUnique({
      where: {
        userId_provider_messageId: {
          userId: params.userId,
          provider: "GMAIL",
          messageId: params.message.messageId,
        },
      },
    });

    // A parser exception is not evidence that the old parse became invalid.
    // Record the failure, but preserve the prior projection for safe retries.
    if (parserError && existing && params.mode === "reprocess") {
      const transaction = await transactionDb.emailTransaction.update({
        where: { id: existing.id },
        data: { parserError },
      });
      return {
        transaction,
        parsedPurchase,
        parserError,
        transactionAction: "updated",
        purchaseAction: "none",
      };
    }

    if (existing && params.mode === "scan") {
      return {
        transaction: existing,
        parsedPurchase,
        parserError,
        transactionAction: "skipped",
        purchaseAction: "none",
      };
    }

    const data = emailTransactionData(
      params.userId,
      params.message,
      parsedPurchase,
      merchant,
      parserError,
    );
    const qualifies = !parserError && hasPurchaseEvidence(parsedPurchase);
    const previousPurchaseId = existing?.purchaseId ?? null;
    const transaction = await transactionDb.emailTransaction.upsert({
      where: {
        userId_provider_messageId: {
          userId: params.userId,
          provider: "GMAIL",
          messageId: params.message.messageId,
        },
      },
      create: data,
      update: {
        merchant: data.merchant,
        fromEmail: data.fromEmail,
        subject: data.subject,
        purchasedAt: data.purchasedAt,
        orderId: data.orderId,
        totalCents: data.totalCents,
        currency: data.currency,
        items: data.items,
        rawSource: data.rawSource,
        parserError: data.parserError,
        ...(params.mode === "reprocess" && !qualifies ? { purchaseId: null } : {}),
      },
    });

    if (qualifies) {
      const promoted = await promotePurchase(transactionDb, {
        userId: params.userId,
        message: params.message,
        transaction,
      });
      return {
        transaction: promoted.transaction,
        parsedPurchase,
        parserError,
        transactionAction: existing ? "updated" : "created",
        purchaseAction: promoted.action,
      };
    }

    const purchaseAction = params.mode === "reprocess"
      ? await demotePurchase(transactionDb, {
          userId: params.userId,
          messageId: params.message.messageId,
          previousPurchaseId,
        })
      : "none";

    return {
      transaction,
      parsedPurchase,
      parserError,
      transactionAction: existing ? "updated" : "created",
      purchaseAction,
    };
  });
}
