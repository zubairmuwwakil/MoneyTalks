import {
  Prisma,
  type EmailTransaction,
  type PrismaClient,
} from "@prisma/client";

import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";
import { applyCapAccrual, removeCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import type { RawGmailMessage } from "@/lib/services/gmailScanSource";
import { resolveEmailMerchantIdentity } from "./emailMerchant";
import {
  parsePurchaseFromRawGmailMessage,
  type Purchase as ParsedPurchase,
} from "./gmailPurchaseParser";
import { GMAIL_RECEIPT_PARSER_VERSION } from "./parserVersions";
import { hasPurchaseEvidence } from "./receiptEvidence";
import { normalizeCurrencyCode } from "@/lib/utils/currency";
import { resolveCategory, shouldAutoApply } from "@/lib/domain/merchants/resolveCategory";
import {
  reconcileCurrency,
  resolveCurrency,
  shouldAutoApply as shouldApplyCurrency,
  type CurrencySource,
} from "./resolveCurrency";

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
  connectionId: string | null,
) {
  const items = parsed.items === undefined
    ? Prisma.DbNull
    : parsed.items as Prisma.InputJsonValue;

  return {
    userId,
    provider: "GMAIL" as const,
    messageId: message.messageId,
    connectionId,
    // Gmail's messageId above identifies the message IN THIS MAILBOX; this one
    // is assigned by the sender and is identical in every mailbox it reaches.
    // Only the second can tell "one receipt, twice" from "two receipts".
    rfc822MessageId: message.rfc822MessageId,
    merchant,
    fromEmail: parsed.fromEmail ?? null,
    subject: parsed.subject ?? null,
    purchasedAt: parsed.purchasedAt ?? message.internalDate ?? null,
    orderId: parsed.orderId ?? null,
    totalCents: parsed.totalCents ?? null,
    currency: normalizeCurrencyCode(parsed.currency),
    items,
    rawSource: parsed.rawSource,
    parserVersion: GMAIL_RECEIPT_PARSER_VERSION,
    parserError,
  };
}

/**
 * The parser resolves only message-local evidence. The orchestration boundary
 * supplies the owner's merchant-scoped answer after canonical merchant
 * identity is known; the resolver itself stays pure and synchronous.
 */
function withOwnerConfirmedMerchantCurrency(
  parsed: ParsedPurchase,
  ownerConfirmedMerchantCurrency: string | null | undefined,
): ParsedPurchase {
  if (!ownerConfirmedMerchantCurrency) return parsed;

  const resolution = resolveCurrency({
    messageText: parsed.textBody,
    // The parser already screened JSON-LD through the same resolver. When a
    // learned value is present, replaying the message evidence preserves the
    // strict direct-evidence-over-learned order without a database call here.
    markupCurrency: parsed.rawSource === "jsonld" ? parsed.currency : undefined,
    ownerConfirmedMerchantCurrency,
  });
  return {
    ...parsed,
    currency: shouldApplyCurrency(resolution) ? resolution.currency ?? undefined : undefined,
    currencySource: resolution.source,
  };
}

type ReceiptTransaction = Prisma.TransactionClient;

const TRIVIAL_ORDER_NUMBERS = new Set([
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "not available",
]);

/**
 * Order ids come from untrusted merchant templates. Reject missing-value
 * placeholders and punctuation-only/very short fragments: a false merge is
 * irreversible, while a miss merely leaves a duplicate for later review.
 */
function usableOrderNumber(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || TRIVIAL_ORDER_NUMBERS.has(trimmed.toLowerCase())) return null;
  const meaningfulCharacters = trimmed.match(/[a-z0-9]/gi)?.length ?? 0;
  return meaningfulCharacters >= 3 ? trimmed : null;
}


async function promotePurchase(
  db: ReceiptTransaction,
  params: {
    userId: string;
    message: RawGmailMessage;
    transaction: EmailTransaction;
    mode: GmailMessageProcessingMode;
    /**
     * Which tier of ./resolveCurrency decided the parsed currency. It rides
     * alongside rather than through `EmailTransaction`, which stores the value
     * but has no column for its provenance.
     */
    currencySource: CurrencySource;
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

  // Categorize from the receipt.
  //
  // An e-receipt carries the single strongest signal in the whole system and
  // this path was ignoring it: `fromEmail`. A payment descriptor is a guess
  // about identity ("SQ *CAFE METRO" could be anything); a sender domain is
  // not — noreply@ubereats.com is Uber Eats and nothing else.
  //
  // It mattered more here than anywhere else, because the accrual gate below
  // requires BOTH a payment method and a category, and nothing on this path
  // ever set a category. Every Gmail-sourced purchase was therefore excluded
  // from the cap ledger outright, not merely mis-scored.
  const emailAlias = await db.merchantAlias.findUnique({
    where: { rawString: emailTransaction.merchant },
  });
  const emailResolution = resolveCategory({
    merchantRaw: emailTransaction.merchant,
    emailFromAddress: emailTransaction.fromEmail,
    aliasCategory: emailAlias?.category,
  });
  const emailCategory = shouldAutoApply(emailResolution) ? emailResolution.category : null;
  const emailCategorySource = emailCategory ? emailResolution.source : null;

  // What this email alone says the currency is. Reconciled below against the
  // owner's own correction and any linked Wallet capture.
  const emailCurrency = {
    currency: normalizeCurrencyCode(emailTransaction.currency),
    source: params.currencySource,
  };
  let matchedByOrderNumber = false;
  let orderMatchMayEnrich = false;
  let supersededPurchaseId: string | null = null;
  let ownerProtected = false;

  // Rows created before lifecycle/RFC822 dedup landed already have their own
  // purchaseId, so the ordinary "prior canonical link wins" rule would make
  // the stronger identities below unreachable forever. During an explicit
  // reprocess only, choose the earliest already-linked observation as the
  // canonical purchase. A normal scan remains idempotent, and an owner's
  // correction remains a hard boundary: neither merge nor refresh it.
  if (params.mode === "reprocess" && purchase?.source === "GMAIL") {
    const correction = await db.purchaseCorrection.findFirst({
      where: {
        userId,
        purchaseId: purchase.id,
        kind: "details",
        undoneAt: null,
      },
      select: { id: true },
    });
    ownerProtected = Boolean(correction);

    if (!ownerProtected) {
      const canonicalTwin = emailTransaction.rfc822MessageId
        ? await db.emailTransaction.findFirst({
            where: {
              userId,
              rfc822MessageId: emailTransaction.rfc822MessageId,
              purchaseId: { not: null },
            },
            select: { purchaseId: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          })
        : null;
      if (canonicalTwin?.purchaseId && canonicalTwin.purchaseId !== purchase.id) {
        const canonical = await db.purchase.findUnique({ where: { id: canonicalTwin.purchaseId } });
        if (canonical) {
          supersededPurchaseId = purchase.id;
          purchase = canonical;
          action = "linked";
        }
      }

      if (!supersededPurchaseId) {
        const orderNumber = usableOrderNumber(emailTransaction.orderId);
        const canonicalOrder = orderNumber
          ? await db.purchase.findFirst({
              where: {
                userId,
                merchant: { equals: emailTransaction.merchant, mode: "insensitive" },
                orderNumber: { equals: orderNumber, mode: "insensitive" },
              },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            })
          : null;
        if (canonicalOrder && canonicalOrder.id !== purchase.id) {
          supersededPurchaseId = purchase.id;
          purchase = canonicalOrder;
          matchedByOrderNumber = true;
          action = "linked";
        }
      }
    }
  }

  if (purchase?.source === "GMAIL" && !supersededPurchaseId && !ownerProtected) {
    // Reprocessing must clear a historical guessed CAD value, but a linked
    // Wallet observation with an explicit code is valid enrichment and wins
    // when the email itself remains ambiguous.
    const walletCurrency = await db.walletEvent.findFirst({
      where: { purchaseId: purchase.id, currencyRaw: { not: null } },
      select: { currencyRaw: true },
      orderBy: { capturedAt: "asc" },
    });
    // An owner's correction is an instruction, not evidence: a reprocess may
    // refresh every other field but must not restate the unit they fixed.
    const canonical = reconcileCurrency({
      ownerCurrency: purchase.currencySource === "userOverride" ? purchase.currency : null,
      receipt: emailCurrency,
      walletCurrency: walletCurrency?.currencyRaw,
    });
    purchase = await db.purchase.update({
      where: { id: purchase.id },
      data: {
        merchant: emailTransaction.merchant,
        totalCents: emailTransaction.totalCents ?? null,
        currency: canonical.currency,
        currencySource: canonical.source,
        purchasedAt: emailTransaction.purchasedAt ?? message.internalDate ?? new Date(),
        // Reprocessing exists to correct stale values, but a re-parse that
        // finds no order number is a parser miss, not evidence the stored one
        // was wrong — and unlike the guessed currency above, an order number
        // was extracted rather than defaulted. Writing null here erased 15 of
        // them across Vercel and Anthropic in a production dry run. This is
        // the same rule the `category` line below already states.
        orderNumber: usableOrderNumber(emailTransaction.orderId) ?? purchase.orderNumber,
        // Never overwrite a category already on the row: it may be an owner
        // decision, and this resolution is only ever as good as its tier.
        category: purchase.category ?? emailCategory,
        categorySource: purchase.category ? undefined : emailCategorySource,
      },
    });
    action = "updated";
  } else if (!purchase) {
    // The canonical link and this email's own source key have both come up
    // empty, so the same message may already have been ingested from another
    // of this owner's mailboxes. Gmail's message id is per-mailbox; the
    // sender's RFC822 Message-ID is not, which is what makes it the key here.
    //
    // Scoped to userId: two people can be sent receipts carrying the same
    // sender-assigned id, and linking those would be a leak, not a merge.
    const twin = emailTransaction.rfc822MessageId
      ? await db.emailTransaction.findFirst({
          where: {
            userId,
            rfc822MessageId: emailTransaction.rfc822MessageId,
            id: { not: emailTransaction.id },
            purchaseId: { not: null },
          },
          select: { purchaseId: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : null;
    if (twin?.purchaseId) {
      purchase = await db.purchase.findUnique({ where: { id: twin.purchaseId } });
      if (purchase) action = "linked";
    }
  }

  if (!purchase) {
    // Distinct lifecycle messages carry distinct Gmail and RFC822 ids, but a
    // merchant's order number identifies the real purchase they describe.
    // `emailTransaction.merchant` has already passed through the shared
    // merchant resolver above; owner + canonical merchant prevent a common
    // order like "12345" from crossing either boundary.
    const orderNumber = usableOrderNumber(emailTransaction.orderId);
    const orderMatch = orderNumber
      ? await db.purchase.findFirst({
          where: {
            userId,
            merchant: { equals: emailTransaction.merchant, mode: "insensitive" },
            orderNumber: { equals: orderNumber, mode: "insensitive" },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : null;

    if (orderMatch) {
      purchase = orderMatch;
      matchedByOrderNumber = true;
      action = "linked";
    }
  }

  if (matchedByOrderNumber && purchase) {
    // A details correction is an owner decision. The email remains useful
    // provenance, but it is no longer allowed to mutate the chosen row.
    const ownerCorrected = await db.purchaseCorrection.findFirst({
      where: {
        userId,
        purchaseId: purchase.id,
        kind: "details",
        undoneAt: null,
      },
      select: { id: true },
    });
    orderMatchMayEnrich = !ownerCorrected;

    if (orderMatchMayEnrich) {
      const fillsTotal = purchase.totalCents == null && emailTransaction.totalCents != null;
      const fillsCurrency = purchase.currency == null && emailCurrency.currency != null;
      const fillsCategory = purchase.category == null && emailCategory != null;
      if (fillsTotal || fillsCurrency || fillsCategory) {
        purchase = await db.purchase.update({
          where: { id: purchase.id },
          data: {
            totalCents: fillsTotal ? emailTransaction.totalCents : undefined,
            currency: fillsCurrency ? emailCurrency.currency : undefined,
            currencySource: fillsCurrency ? emailCurrency.source : undefined,
            category: fillsCategory ? emailCategory : undefined,
            categorySource: fillsCategory ? emailCategorySource : undefined,
          },
        });
      }
    }
  }

  // Deliberately a fresh test rather than an `else`: the twin above may have
  // resolved the purchase, and the order lookup may have done the same.
  // findMatchingPurchase must not run after either stronger identity signal.
  // A shared Message-ID is evidence of ONE message; an order number identifies
  // one merchant order; amount and date are only an inference, so they follow.
  if (!purchase) {
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
          orderNumber: match.purchase.orderNumber ?? usableOrderNumber(emailTransaction.orderId) ?? undefined,
          // Gap-fill only, like the category below: the wallet side of this
          // purchase may already carry a currency, and it is not this email's
          // place to restate it.
          currency: match.purchase.currency ?? emailCurrency.currency,
          currencySource: match.purchase.currency ? undefined : emailCurrency.source,
          // The wallet side of this purchase had only a descriptor to go on;
          // the email side has a sender domain. Filling a gap here is the
          // cross-source merge earning its keep.
          category: match.purchase.category ?? emailCategory ?? undefined,
          categorySource: match.purchase.category ? undefined : emailCategorySource ?? undefined,
        },
      });
      action = "linked";
    } else {
      purchase = await db.purchase.create({
        data: {
          userId,
          merchant: emailTransaction.merchant,
          totalCents: emailTransaction.totalCents ?? null,
          currency: emailCurrency.currency,
          currencySource: emailCurrency.source,
          purchasedAt: observedAt,
          // Persist the same conservative key used by the lifecycle lookup so
          // later messages do not miss because the parser left outer spaces.
          orderNumber: usableOrderNumber(emailTransaction.orderId),
          paymentMethod: null,
          source: "GMAIL",
          sourceEmailId: message.messageId,
          category: emailCategory,
          categorySource: emailCategorySource,
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

  if (supersededPurchaseId) {
    // Reuse the established evidence-aware cleanup. It deletes only an
    // orphaned Gmail projection; purchases with wallet/statement/other email
    // evidence survive and merely lose the obsolete email provenance.
    await demotePurchase(db, {
      userId,
      messageId: message.messageId,
      previousPurchaseId: supersededPurchaseId,
    });
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

  // A lifecycle email can enrich an order that has no item detail, but it may
  // never replace richer items from the original receipt with a partial or
  // empty list. Owner corrections disable this enrichment along with fields.
  if (matchedByOrderNumber && orderMatchMayEnrich && parsedItems && parsedItems.length > 0) {
    const existingItem = await db.purchaseItem.findFirst({
      where: { purchaseId: purchase.id },
      select: { id: true },
    });
    if (!existingItem) {
      await db.purchaseItem.createMany({
        data: parsedItems.map((item) => ({
          purchaseId: purchase.id,
          title: String(item.name ?? "Item"),
          qty: typeof item.quantity === "number" ? Math.max(1, Math.round(item.quantity)) : null,
          priceCents: typeof item.price === "number" ? Math.round(item.price * 100) : null,
          currency: purchase.currency,
        })),
      });
    }
  }

  // An owning email's empty item list is meaningful during reprocessing: it
  // clears stale line items. For a cross-source purchase, leave unrelated
  // items alone unless this email actually supplied replacements.
  if (!ownerProtected && !matchedByOrderNumber && (emailOwnsPurchase || parsedItems)) {
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
    /** The mailbox this copy arrived in. Absent for legacy reprocessing. */
    connectionId?: string | null;
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

  const merchantResolution = parserError
    ? {
        merchant: parsedPurchase.merchant,
        identity: "RESOLVED" as const,
        source: "SENDER" as const,
      }
    : await resolveEmailMerchantIdentity(
        db,
        parsedPurchase.merchant,
        parsedPurchase.fromEmail,
        { subject: parsedPurchase.subject, textBody: parsedPurchase.textBody },
      );
  const merchant = merchantResolution.merchant;

  return db.$transaction(async (transactionDb) => {
    const merchantCurrency = await transactionDb.merchantCurrencyConfirmation.findUnique({
      where: {
        userId_merchantCanonicalId: {
          userId: params.userId,
          merchantCanonicalId: merchant,
        },
      },
      select: { currency: true },
    });
    parsedPurchase = withOwnerConfirmedMerchantCurrency(parsedPurchase, merchantCurrency?.currency);

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
        data: { parserError, parserVersion: GMAIL_RECEIPT_PARSER_VERSION },
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
      params.connectionId ?? null,
    );
    // A conduit proves that money moved but does not identify who received it.
    // Preserve the EmailTransaction for later replay, but do not manufacture a
    // Purchase that every downstream aggregation would confidently pool.
    const qualifies = !parserError
      && merchantResolution.identity === "RESOLVED"
      && hasPurchaseEvidence(parsedPurchase);
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
        parserVersion: data.parserVersion,
        parserError: data.parserError,
        // Backfills the id onto rows ingested before it was captured, which is
        // how an existing history becomes deduplicable at all.
        rfc822MessageId: data.rfc822MessageId,
        // Only ever set, never cleared: a reprocess that does not know which
        // mailbox a row came from must not erase the answer.
        ...(data.connectionId ? { connectionId: data.connectionId } : {}),
        ...(params.mode === "reprocess" && !qualifies ? { purchaseId: null } : {}),
      },
    });

    if (qualifies) {
      const promoted = await promotePurchase(transactionDb, {
        userId: params.userId,
        message: params.message,
        transaction,
        mode: params.mode,
        currencySource: parsedPurchase.currencySource ?? "none",
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
