import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { processRawGmailMessage } from "./gmailReceiptProcessing";
import { parsePurchaseFromRawGmailMessage } from "./gmailPurchaseParser";
import { resolveEmailMerchantIdentity } from "./emailMerchant";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";
import { removeCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";
import type { RawGmailMessage } from "@/lib/services/gmailScanSource";

vi.mock("./gmailPurchaseParser", () => ({ parsePurchaseFromRawGmailMessage: vi.fn() }));
vi.mock("./emailMerchant", () => ({ resolveEmailMerchantIdentity: vi.fn() }));
vi.mock("@/lib/domain/spine/purchaseMerge", () => ({ findMatchingPurchase: vi.fn() }));
vi.mock("@/lib/domain/ownerState", () => ({ ensureOwnerStateRecord: vi.fn() }));
vi.mock("@/lib/spine/cap-usage", () => ({ applyCapAccrual: vi.fn(), removeCapAccrual: vi.fn(), reverseCapAccrual: vi.fn() }));

// Deliberately a narrow literal rather than a `RawGmailMessage` annotation:
// several fixtures below pass `message.internalDate` where a plain Date is
// required, and widening it to `Date | null` would break them for no gain.
const message = {
  messageId: "gmail-1",
  raw: Buffer.from("raw MIME"),
  subject: "Old subject",
  from: "orders@example.com",
  internalDate: new Date("2026-08-01T12:00:00.000Z"),
  // Most fixtures predate the header; the cross-mailbox cases set it.
  rfc822MessageId: null as string | null,
};

function rawMessage(overrides: Partial<RawGmailMessage> = {}): RawGmailMessage {
  return { ...message, ...overrides };
}

type TwinRow = {
  id: string;
  userId: string;
  rfc822MessageId: string | null;
  purchaseId: string | null;
};

/**
 * Stands in for `emailTransaction.findFirst` by actually APPLYING the
 * where-clause the code passes, rather than asserting on its shape. Shape
 * assertions still pass when `userId` is dropped from the filter; this fails,
 * which is the whole point — an unscoped lookup would link one owner's
 * receipt to another owner's purchase.
 */
function twinLookup(rows: TwinRow[]) {
  const matches = (row: TwinRow, key: string, condition: unknown) => {
    const value = row[key as keyof TwinRow];
    if (condition !== null && typeof condition === "object" && "not" in condition) {
      const excluded = (condition as { not: unknown }).not;
      return excluded === null ? value !== null : value !== excluded;
    }
    return value === condition;
  };
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find((row) => Object.entries(where).every(([key, cond]) => matches(row, key, cond))) ?? null,
  );
}

function orderLookup<Row extends { userId: string; merchant: string; orderNumber: string | null }>(
  rows: Row[],
) {
  const matches = (row: Row, key: string, condition: unknown) => {
    const value = row[key as keyof Row];
    if (condition !== null && typeof condition === "object" && "equals" in condition) {
      const expected = (condition as { equals: unknown }).equals;
      return typeof value === "string" && typeof expected === "string"
        ? value.toLowerCase() === expected.toLowerCase()
        : value === expected;
    }
    return value === condition;
  };
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find((row) => Object.entries(where).every(([key, cond]) => matches(row, key, cond))) ?? null,
  );
}

const existingTransaction = {
  id: "email-tx-1",
  userId: "user-1",
  provider: "GMAIL",
  messageId: message.messageId,
  merchant: "Old Merchant",
  fromEmail: "old@example.com",
  subject: "Old subject",
  purchasedAt: message.internalDate,
  orderId: "OLD-ORDER",
  totalCents: 9999,
  currency: "CAD",
  items: [{ name: "Old item" }],
  rawSource: "text",
  parserError: null,
  purchaseId: null,
  createdAt: new Date("2026-08-02T00:00:00.000Z"),
};

function setupDb() {
  const tx = {
    emailTransaction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    purchase: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    purchaseCorrection: { findFirst: vi.fn() },
    purchaseItem: { findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    receiptDocument: { findMany: vi.fn() },
    purchaseAttachment: { createMany: vi.fn(), deleteMany: vi.fn() },
    ownerStateRecord: { findUnique: vi.fn(), create: vi.fn() },
    creditCard: { findMany: vi.fn() },
    capAccrual: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    capUsageLedger: { upsert: vi.fn(), update: vi.fn() },
    walletEvent: { findFirst: vi.fn() },
    merchantCurrencyConfirmation: { findUnique: vi.fn() },
    // The real TransactionClient has this; promotePurchase reads it to find
    // any curated category before falling back to the merchant pack.
    merchantAlias: { findUnique: vi.fn() },
  };
  const db = {
    merchantAlias: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };

  tx.receiptDocument.findMany.mockResolvedValue([]);
  tx.emailTransaction.findFirst.mockResolvedValue(null);
  tx.purchase.findFirst.mockResolvedValue(null);
  tx.purchaseCorrection.findFirst.mockResolvedValue(null);
  tx.purchaseItem.findFirst.mockResolvedValue(null);
  tx.merchantAlias.findUnique.mockResolvedValue(null);
  tx.merchantCurrencyConfirmation.findUnique.mockResolvedValue(null);
  vi.mocked(resolveEmailMerchantIdentity).mockImplementation(async (_db, merchant) => ({
    merchant,
    identity: "RESOLVED",
    source: "SENDER",
  }));
  vi.mocked(findMatchingPurchase).mockResolvedValue(null);

  return { db, tx };
}

describe("processRawGmailMessage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("leaves an existing row untouched during an ordinary scan", async () => {
    const { db, tx } = setupDb();
    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Example Store",
      rawSource: "text",
      orderId: undefined,
      totalCents: 4242,
    });
    tx.emailTransaction.findUnique.mockResolvedValue(existingTransaction);

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "scan",
    });

    expect(result.transactionAction).toBe("skipped");
    expect(tx.emailTransaction.upsert).not.toHaveBeenCalled();
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });

  it("reprocesses stored fields and promotes a row that now has evidence", async () => {
    const { db, tx } = setupDb();
    const reparsed = {
      messageId: message.messageId,
      merchant: "Example Store",
      fromEmail: "new@example.com",
      subject: "Your corrected receipt",
      purchasedAt: new Date("2026-08-03T10:00:00.000Z"),
      orderId: undefined,
      totalCents: 4242,
      currency: "usd",
      items: undefined,
      rawSource: "text" as const,
      textBody: "Total charged USD 42.42",
    };
    const refreshedTransaction = {
      ...existingTransaction,
      merchant: reparsed.merchant,
      fromEmail: reparsed.fromEmail,
      subject: reparsed.subject,
      purchasedAt: reparsed.purchasedAt,
      orderId: null,
      totalCents: reparsed.totalCents,
      currency: "USD",
      items: null,
    };
    const createdPurchase = {
      id: "purchase-1",
      userId: "user-1",
      merchant: reparsed.merchant,
      totalCents: reparsed.totalCents,
      currency: "USD",
      purchasedAt: reparsed.purchasedAt,
      orderNumber: null,
      paymentMethod: null,
      category: null,
      source: "GMAIL",
      sourceEmailId: message.messageId,
      sourceEventId: null,
      possibleDuplicateOfId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(reparsed);
    tx.emailTransaction.findUnique.mockResolvedValue(existingTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshedTransaction);
    tx.emailTransaction.update.mockResolvedValue({ ...refreshedTransaction, purchaseId: createdPurchase.id });
    tx.purchase.findUnique.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue(createdPurchase);

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        merchant: "Example Store",
        orderId: null,
        totalCents: 4242,
        currency: "USD",
        items: Prisma.DbNull,
        parserError: null,
      }),
    }));
    expect(tx.purchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        source: "GMAIL",
        sourceEmailId: message.messageId,
        totalCents: 4242,
      }),
    });
    expect(tx.emailTransaction.update).toHaveBeenCalledWith({
      where: { id: existingTransaction.id },
      data: { purchaseId: createdPurchase.id },
    });
    expect(result).toMatchObject({
      transactionAction: "updated",
      purchaseAction: "created",
      parserError: null,
    });
  });

  it("reprocessing reconciles a persisted public-suffix merchant", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = {
      ...existingTransaction,
      merchant: "co.uk",
      fromEmail: "notifications@shopify.co.uk",
      purchaseId: "purchase-legacy-domain",
    };
    const parsed = {
      messageId: message.messageId,
      merchant: "shopify.co.uk",
      fromEmail: "notifications@shopify.co.uk",
      subject: "Your Shopify receipt",
      purchasedAt: message.internalDate,
      orderId: "ORDER-42",
      totalCents: 4200,
      currency: "gbp",
      rawSource: "text" as const,
      textBody: "Order total: GBP 42.00",
    };
    const refreshedTransaction = {
      ...linkedTransaction,
      ...parsed,
      merchant: "shopify.co.uk",
      currency: "GBP",
    };
    const legacyPurchase = {
      id: linkedTransaction.purchaseId,
      userId: "user-1",
      merchant: "co.uk",
      totalCents: 4200,
      currency: "GBP",
      purchasedAt: message.internalDate,
      orderNumber: "ORDER-42",
      paymentMethod: null,
      category: null,
      source: "GMAIL",
      sourceEmailId: message.messageId,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(parsed);
    vi.mocked(resolveEmailMerchantIdentity).mockResolvedValue({
      merchant: "shopify.co.uk",
      identity: "RESOLVED",
      source: "SENDER",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshedTransaction);
    tx.purchase.findUnique.mockResolvedValue(legacyPurchase);
    tx.walletEvent.findFirst.mockResolvedValue(null);
    tx.purchase.update.mockResolvedValue({ ...legacyPurchase, merchant: "shopify.co.uk" });

    await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(resolveEmailMerchantIdentity).toHaveBeenCalledWith(
      db,
      "shopify.co.uk",
      "notifications@shopify.co.uk",
      { subject: parsed.subject, textBody: parsed.textBody },
    );
    expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ merchant: "shopify.co.uk" }),
    }));
    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: legacyPurchase.id },
      data: expect.objectContaining({ merchant: "shopify.co.uk" }),
    }));
  });

  it("categorizes a new purchase from the receipt's sender domain", async () => {
    const { db, tx } = setupDb();
    // The descriptor is useless; the sender is not. Before the resolver, this
    // purchase was created with no category at all — and the accrual gate
    // below requires one, so it never reached the cap ledger.
    const reparsed = {
      messageId: message.messageId,
      merchant: "Order 8812",
      fromEmail: "noreply@ubereats.com",
      subject: "Your Uber Eats order",
      purchasedAt: new Date("2026-08-03T10:00:00.000Z"),
      orderId: undefined,
      totalCents: 3199,
      currency: "cad",
      items: undefined,
      rawSource: "text" as const,
      textBody: "Total CAD 31.99",
    };
    const refreshed = {
      ...existingTransaction,
      merchant: reparsed.merchant,
      fromEmail: reparsed.fromEmail,
      totalCents: reparsed.totalCents,
      currency: "CAD",
      purchasedAt: reparsed.purchasedAt,
      items: null,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(reparsed);
    tx.emailTransaction.findUnique.mockResolvedValue(existingTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshed);
    tx.emailTransaction.update.mockResolvedValue({ ...refreshed, purchaseId: "purchase-9" });
    tx.purchase.findUnique.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue({
      id: "purchase-9", userId: "user-1", merchant: reparsed.merchant, totalCents: 3199,
      currency: "CAD", purchasedAt: reparsed.purchasedAt, orderNumber: null, paymentMethod: null,
      category: "foodDelivery", categorySource: "emailDomain", source: "GMAIL",
      sourceEmailId: message.messageId, sourceEventId: null, possibleDuplicateOfId: null,
      createdAt: new Date(), updatedAt: new Date(),
    });

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.purchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: "foodDelivery",
        categorySource: "emailDomain",
      }),
    });
  });

  it("does not overwrite a category already on the row", async () => {
    const { db, tx } = setupDb();
    const reparsed = {
      messageId: message.messageId,
      merchant: "Uber Eats",
      fromEmail: "noreply@ubereats.com",
      subject: "receipt",
      purchasedAt: new Date("2026-08-03T10:00:00.000Z"),
      orderId: undefined,
      totalCents: 3199,
      currency: "cad",
      items: undefined,
      rawSource: "text" as const,
      textBody: "Total CAD 31.99",
    };
    const refreshed = { ...existingTransaction, merchant: reparsed.merchant, fromEmail: reparsed.fromEmail,
      totalCents: 3199, currency: "CAD", purchasedAt: reparsed.purchasedAt, items: null,
      purchaseId: "purchase-7" };
    const existingPurchase = {
      id: "purchase-7", userId: "user-1", merchant: "Uber Eats", totalCents: 3199, currency: "CAD",
      purchasedAt: reparsed.purchasedAt, orderNumber: null, paymentMethod: null,
      // The owner said "dining" for this merchant. A tier-5 pack reading must
      // not quietly replace a tier-1 decision on reprocess.
      category: "dining", categorySource: "userOverride", source: "GMAIL",
      sourceEmailId: message.messageId, sourceEventId: null, possibleDuplicateOfId: null,
      createdAt: new Date(), updatedAt: new Date(),
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(reparsed);
    tx.emailTransaction.findUnique.mockResolvedValue(existingTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshed);
    tx.emailTransaction.update.mockResolvedValue(refreshed);
    tx.purchase.findUnique.mockResolvedValue(existingPurchase);
    tx.purchase.update.mockResolvedValue(existingPurchase);

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: "dining", categorySource: undefined }),
    }));
  });

  it("records which tier decided the currency of a new purchase", async () => {
    const { db, tx } = setupDb();
    const reparsed = {
      messageId: message.messageId, merchant: "anthropic.com", fromEmail: "billing@anthropic.com",
      subject: "Your receipt", purchasedAt: new Date("2026-08-03T10:00:00.000Z"), orderId: undefined,
      totalCents: 12000, currency: "USD", currencySource: "explicitCode" as const, items: undefined,
      rawSource: "text" as const, textBody: "Total $120.00\nAll amounts are in USD.",
    };
    const refreshed = { ...existingTransaction, merchant: reparsed.merchant, fromEmail: reparsed.fromEmail,
      totalCents: 12000, currency: "USD", purchasedAt: reparsed.purchasedAt, items: null };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(reparsed);
    tx.emailTransaction.findUnique.mockResolvedValue(existingTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshed);
    tx.emailTransaction.update.mockResolvedValue({ ...refreshed, purchaseId: "purchase-11" });
    tx.purchase.findUnique.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue({ id: "purchase-11", userId: "user-1", merchant: reparsed.merchant,
      totalCents: 12000, currency: "USD", currencySource: "explicitCode", purchasedAt: reparsed.purchasedAt,
      orderNumber: null, paymentMethod: null, category: null, categorySource: null, source: "GMAIL",
      sourceEmailId: message.messageId, sourceEventId: null, possibleDuplicateOfId: null,
      createdAt: new Date(), updatedAt: new Date() });

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.purchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ currency: "USD", currencySource: "explicitCode" }),
    });
  });

  it("looks up a learned merchant currency by the current owner and still lets an explicit receipt code win", async () => {
    const { db, tx } = setupDb();
    const reparsed = {
      messageId: message.messageId, merchant: "heroku.com", fromEmail: "billing@heroku.com",
      subject: "Your receipt", purchasedAt: new Date("2026-08-03T10:00:00.000Z"), orderId: undefined,
      totalCents: 101, currency: "CAD", currencySource: "explicitCode" as const, items: undefined,
      rawSource: "text" as const, textBody: "Total CAD 1.01",
    };
    const refreshed = { ...existingTransaction, merchant: reparsed.merchant, fromEmail: reparsed.fromEmail,
      totalCents: 101, currency: "CAD", purchasedAt: reparsed.purchasedAt, items: null };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(reparsed);
    tx.merchantCurrencyConfirmation.findUnique.mockResolvedValue({ currency: "USD" });
    tx.emailTransaction.findUnique.mockResolvedValue(null);
    tx.emailTransaction.upsert.mockResolvedValue(refreshed);
    tx.emailTransaction.update.mockResolvedValue({ ...refreshed, purchaseId: "purchase-learned" });
    tx.purchase.findUnique.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue({ id: "purchase-learned", userId: "user-1", merchant: reparsed.merchant,
      totalCents: 101, currency: "CAD", currencySource: "explicitCode", purchasedAt: reparsed.purchasedAt,
      orderNumber: null, paymentMethod: null, category: null, categorySource: null, source: "GMAIL",
      sourceEmailId: message.messageId, sourceEventId: null, possibleDuplicateOfId: null,
      createdAt: new Date(), updatedAt: new Date() });

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.merchantCurrencyConfirmation.findUnique).toHaveBeenCalledWith({
      where: { userId_merchantCanonicalId: { userId: "user-1", merchantCanonicalId: "heroku.com" } },
      select: { currency: true },
    });
    expect(tx.purchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ currency: "CAD", currencySource: "explicitCode" }),
    });
  });

  it("does not overwrite a currency the owner corrected", async () => {
    const { db, tx } = setupDb();
    // Reprocessing used to restate Purchase.currency unconditionally, so a
    // correction survived only until the next scan re-read the receipt.
    const reparsed = {
      messageId: message.messageId, merchant: "store.com", fromEmail: "orders@store.com",
      subject: "receipt", purchasedAt: new Date("2026-08-03T10:00:00.000Z"), orderId: undefined,
      totalCents: 3199, currency: "USD", currencySource: "explicitCode" as const, items: undefined,
      rawSource: "text" as const, textBody: "Total USD 31.99",
    };
    const refreshed = { ...existingTransaction, merchant: reparsed.merchant, fromEmail: reparsed.fromEmail,
      totalCents: 3199, currency: "USD", purchasedAt: reparsed.purchasedAt, items: null,
      purchaseId: "purchase-12" };
    const existingPurchase = { id: "purchase-12", userId: "user-1", merchant: "store.com", totalCents: 3199,
      currency: "CAD", currencySource: "userOverride", purchasedAt: reparsed.purchasedAt, orderNumber: null,
      paymentMethod: null, category: null, categorySource: null, source: "GMAIL",
      sourceEmailId: message.messageId, sourceEventId: null, possibleDuplicateOfId: null,
      createdAt: new Date(), updatedAt: new Date() };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(reparsed);
    tx.emailTransaction.findUnique.mockResolvedValue(existingTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshed);
    tx.emailTransaction.update.mockResolvedValue(refreshed);
    tx.purchase.findUnique.mockResolvedValue(existingPurchase);
    tx.purchase.update.mockResolvedValue(existingPurchase);
    tx.walletEvent.findFirst.mockResolvedValue(null);

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: "CAD", currencySource: "userOverride" }),
    }));
  });

  it("labels a currency that only a linked wallet capture stated", async () => {
    const { db, tx } = setupDb();
    const reparsed = {
      messageId: message.messageId, merchant: "store.com", fromEmail: "orders@store.com",
      subject: "receipt", purchasedAt: new Date("2026-08-03T10:00:00.000Z"), orderId: undefined,
      totalCents: 3199, currency: undefined, currencySource: "none" as const, items: undefined,
      rawSource: "text" as const, textBody: "Total $31.99",
    };
    const refreshed = { ...existingTransaction, merchant: reparsed.merchant, fromEmail: reparsed.fromEmail,
      totalCents: 3199, currency: null, purchasedAt: reparsed.purchasedAt, items: null,
      purchaseId: "purchase-13" };
    const existingPurchase = { id: "purchase-13", userId: "user-1", merchant: "store.com", totalCents: 3199,
      currency: null, currencySource: null, purchasedAt: reparsed.purchasedAt, orderNumber: null,
      paymentMethod: null, category: null, categorySource: null, source: "GMAIL",
      sourceEmailId: message.messageId, sourceEventId: null, possibleDuplicateOfId: null,
      createdAt: new Date(), updatedAt: new Date() };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(reparsed);
    tx.emailTransaction.findUnique.mockResolvedValue(existingTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshed);
    tx.emailTransaction.update.mockResolvedValue(refreshed);
    tx.purchase.findUnique.mockResolvedValue(existingPurchase);
    tx.purchase.update.mockResolvedValue(existingPurchase);
    tx.walletEvent.findFirst.mockResolvedValue({ currencyRaw: "CAD" });

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: "CAD", currencySource: "walletObservation" }),
    }));
  });

  it("unlinks and deletes an orphaned Gmail purchase that no longer qualifies", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-1" };
    const refreshedTransaction = {
      ...linkedTransaction,
      totalCents: null,
      orderId: null,
      items: null,
      purchaseId: null,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Newsletter Sender",
      rawSource: "text",
      orderId: undefined,
      textBody: "Save 20% this week",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshedTransaction);
    tx.purchase.findUnique.mockResolvedValue({
      id: "purchase-1",
      userId: "user-1",
      source: "GMAIL",
      sourceEmailId: message.messageId,
      emailTransactions: [],
      walletEvents: [],
      statementLines: [],
    });

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ purchaseId: null, totalCents: null, orderId: null }),
    }));
    expect(reverseCapAccrual).toHaveBeenCalledWith(tx, "purchase:purchase-1");
    expect(tx.purchase.delete).toHaveBeenCalledWith({ where: { id: "purchase-1" } });
    expect(result.purchaseAction).toBe("deleted");
  });

  it("keeps unresolved conduit evidence out of the Purchase spine", async () => {
    const { db, tx } = setupDb();
    const parsed = {
      messageId: message.messageId,
      merchant: "paypal.com",
      fromEmail: "service@paypal.com",
      subject: "Your PayPal receipt",
      purchasedAt: message.internalDate,
      totalCents: 903,
      currency: "CAD",
      rawSource: "text" as const,
      textBody: "Payment completed.",
    };
    const transaction = {
      ...existingTransaction,
      merchant: "Unresolved payee via PayPal",
      fromEmail: parsed.fromEmail,
      subject: parsed.subject,
      totalCents: parsed.totalCents,
      currency: parsed.currency,
      purchaseId: null,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(parsed);
    vi.mocked(resolveEmailMerchantIdentity).mockResolvedValue({
      merchant: transaction.merchant,
      identity: "UNRESOLVED_CONDUIT",
      source: "CONDUIT_UNRESOLVED",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(null);
    tx.emailTransaction.upsert.mockResolvedValue(transaction);

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "scan",
    });

    expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ merchant: "Unresolved payee via PayPal", totalCents: 903 }),
    }));
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(result.purchaseAction).toBe("none");
  });

  it("keeps a renewal notice transaction but deletes its false completed purchase", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-renewal" };
    const refreshedTransaction = {
      ...linkedTransaction,
      subject: "Shaheed, here's your auto-renewal notice",
      totalCents: 1868,
      orderId: null,
      items: null,
      purchaseId: null,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "namecheap.com",
      subject: "Shaheed, here's your auto-renewal notice",
      rawSource: "text",
      orderId: undefined,
      totalCents: 1868,
      textBody: "We'll attempt to charge your total balance of $18.68 on the day of renewal.",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshedTransaction);
    tx.purchase.findUnique.mockResolvedValue({
      id: "purchase-renewal",
      userId: "user-1",
      source: "GMAIL",
      sourceEmailId: message.messageId,
      emailTransactions: [],
      walletEvents: [],
      statementLines: [],
    });

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ purchaseId: null, totalCents: 1868 }),
    }));
    expect(tx.purchase.delete).toHaveBeenCalledWith({ where: { id: "purchase-renewal" } });
    expect(result.transaction.totalCents).toBe(1868);
    expect(result.purchaseAction).toBe("deleted");
  });

  it("unlinks but preserves a purchase that still has wallet evidence", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-wallet" };
    const refreshedTransaction = { ...linkedTransaction, purchaseId: null, totalCents: null, orderId: null };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Newsletter Sender",
      rawSource: "text",
      orderId: undefined,
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshedTransaction);
    tx.purchase.findUnique.mockResolvedValue({
      id: "purchase-wallet",
      userId: "user-1",
      source: "WALLET",
      sourceEmailId: null,
      emailTransactions: [],
      walletEvents: [{ id: "wallet-1", eventId: "event-1" }],
      statementLines: [],
    });

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(tx.purchase.delete).not.toHaveBeenCalled();
    expect(reverseCapAccrual).not.toHaveBeenCalled();
    expect(tx.purchaseAttachment.deleteMany).toHaveBeenCalledWith({
      where: { purchaseId: "purchase-wallet", sourceEmailId: message.messageId },
    });
    expect(tx.purchaseItem.deleteMany).toHaveBeenCalledWith({ where: { purchaseId: "purchase-wallet" } });
    expect(result.purchaseAction).toBe("unlinked");
  });

  it("transfers provenance when a Gmail-origin purchase still has wallet evidence", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-shared" };
    const refreshedTransaction = { ...linkedTransaction, purchaseId: null, totalCents: null, orderId: null };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Newsletter Sender",
      rawSource: "text",
      orderId: undefined,
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshedTransaction);
    tx.purchase.findUnique.mockResolvedValue({
      id: "purchase-shared",
      userId: "user-1",
      source: "GMAIL",
      sourceEmailId: message.messageId,
      emailTransactions: [],
      walletEvents: [{ id: "wallet-1", eventId: "event-1" }],
      statementLines: [],
    });

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(tx.purchase.delete).not.toHaveBeenCalled();
    expect(tx.purchase.update).toHaveBeenCalledWith({
      where: { id: "purchase-shared" },
      data: {
        source: "WALLET",
        sourceEmailId: null,
        sourceEventId: "event-1",
      },
    });
    expect(result.purchaseAction).toBe("unlinked");
  });

  it("records a parser error without deleting previously valid evidence", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-1" };
    vi.mocked(parsePurchaseFromRawGmailMessage).mockRejectedValue(new Error("malformed MIME"));
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.update.mockResolvedValue({ ...linkedTransaction, parserError: "malformed MIME" });

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(tx.emailTransaction.update).toHaveBeenCalledWith({
      where: { id: existingTransaction.id },
      data: { parserError: "malformed MIME" },
    });
    expect(tx.emailTransaction.upsert).not.toHaveBeenCalled();
    expect(tx.purchase.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ parserError: "malformed MIME", purchaseAction: "none" });
  });

  it("persists a bare-dollar receipt with unknown currency end to end", async () => {
    const { db, tx } = setupDb();
    const parsed = {
      messageId: message.messageId,
      merchant: "Example Store",
      purchasedAt: message.internalDate,
      totalCents: 4242,
      orderId: undefined,
      currency: undefined,
      items: [{ name: "Thing", quantity: 1, price: 42.42 }],
      rawSource: "text" as const,
      textBody: "Order total: $42.42",
    };
    const transaction = {
      ...existingTransaction,
      merchant: parsed.merchant,
      totalCents: parsed.totalCents,
      currency: null,
      items: parsed.items,
      purchaseId: null,
    };
    const purchase = {
      id: "purchase-unknown-currency",
      userId: "user-1",
      merchant: parsed.merchant,
      totalCents: parsed.totalCents,
      currency: null,
      purchasedAt: parsed.purchasedAt,
      orderNumber: null,
      paymentMethod: null,
      category: null,
      source: "GMAIL",
      sourceEmailId: message.messageId,
      sourceEventId: null,
      possibleDuplicateOfId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue(parsed);
    tx.emailTransaction.findUnique.mockResolvedValue(null);
    tx.emailTransaction.upsert.mockResolvedValue(transaction);
    tx.emailTransaction.update.mockResolvedValue({ ...transaction, purchaseId: purchase.id });
    tx.purchase.findUnique.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue(purchase);

    await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "scan",
    });

    expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ currency: null }),
    }));
    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: null }),
    }));
    expect(tx.purchaseItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ currency: null })],
    });
  });

  describe("cross-mailbox dedup", () => {
    // One receipt delivered to two of the owner's addresses: Gmail assigns a
    // different per-mailbox id in each, but the sender's Message-ID is the
    // same in both. Without this, the pair reads as two purchases and a
    // monthly subscription is detected as biweekly.
    const canonicalPurchase = {
      id: "purchase-inbox-a",
      userId: "user-1",
      merchant: "Netflix",
      totalCents: 1699,
      currency: "CAD",
      currencySource: "receiptExplicit",
      purchasedAt: new Date("2026-08-01T12:00:00.000Z"),
      orderNumber: null,
      paymentMethod: null,
      category: null,
      source: "GMAIL",
      sourceEmailId: "gmail-inbox-a",
      sourceEventId: null,
      possibleDuplicateOfId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function arriveInSecondMailbox(
      tx: ReturnType<typeof setupDb>["tx"],
      opts: { userId?: string; rfc822MessageId: string | null; twins: TwinRow[] },
    ) {
      const transaction = {
        ...existingTransaction,
        id: "email-tx-b",
        userId: opts.userId ?? "user-1",
        messageId: "gmail-inbox-b",
        merchant: "Netflix",
        totalCents: 1699,
        currency: "CAD",
        items: null,
        purchaseId: null,
        rfc822MessageId: opts.rfc822MessageId,
      };

      vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
        messageId: "gmail-inbox-b",
        merchant: "Netflix",
        rawSource: "text",
        orderId: undefined,
        totalCents: 1699,
        currency: "cad",
      });
      tx.emailTransaction.findUnique.mockResolvedValue(null);
      tx.emailTransaction.upsert.mockResolvedValue(transaction);
      tx.emailTransaction.update.mockResolvedValue({ ...transaction, purchaseId: canonicalPurchase.id });
      tx.emailTransaction.findFirst = twinLookup(opts.twins);
      // The sourceEmailId probe passes a compound key and must miss; only the
      // twin's own id lookup resolves.
      tx.purchase.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
        where.id === canonicalPurchase.id ? canonicalPurchase : null,
      );
      tx.purchase.create.mockResolvedValue({ ...canonicalPurchase, id: "purchase-rival", sourceEmailId: "gmail-inbox-b" });

      return processRawGmailMessage(db as never, {
        userId: opts.userId ?? "user-1",
        message: rawMessage({ messageId: "gmail-inbox-b", rfc822MessageId: opts.rfc822MessageId }),
        mode: "scan",
      });
    }

    let db: ReturnType<typeof setupDb>["db"];

    it("links a receipt already ingested from another mailbox instead of creating a rival purchase", async () => {
      const harness = setupDb();
      db = harness.db;
      const { tx } = harness;

      const result = await arriveInSecondMailbox(tx, {
        rfc822MessageId: "receipt-1@netflix.com",
        twins: [{ id: "email-tx-a", userId: "user-1", rfc822MessageId: "receipt-1@netflix.com", purchaseId: canonicalPurchase.id }],
      });

      expect(result.purchaseAction).toBe("linked");
      expect(tx.purchase.create).not.toHaveBeenCalled();
      expect(tx.emailTransaction.update).toHaveBeenCalledWith({
        where: { id: "email-tx-b" },
        data: { purchaseId: canonicalPurchase.id },
      });
      // Evidence of one message outranks an inference from amount and date,
      // so the merge search must not even be consulted.
      expect(findMatchingPurchase).not.toHaveBeenCalled();
      // Nothing about the canonical purchase changed; re-accruing it would be
      // churn on the cap ledger.
      expect(tx.purchase.update).not.toHaveBeenCalled();
      expect(removeCapAccrual).not.toHaveBeenCalled();
    });

    it("still creates separate purchases for genuinely different receipts", async () => {
      const harness = setupDb();
      db = harness.db;
      const { tx } = harness;

      const result = await arriveInSecondMailbox(tx, {
        rfc822MessageId: "receipt-2@netflix.com",
        twins: [{ id: "email-tx-a", userId: "user-1", rfc822MessageId: "receipt-1@netflix.com", purchaseId: canonicalPurchase.id }],
      });

      expect(result.purchaseAction).toBe("created");
      expect(tx.purchase.create).toHaveBeenCalled();
    });

    it("does not deduplicate across owners", async () => {
      const harness = setupDb();
      db = harness.db;
      const { tx } = harness;

      // Two people can be sent receipts carrying the same sender-assigned id.
      // Linking them would hand one owner a pointer into another's ledger.
      const result = await arriveInSecondMailbox(tx, {
        userId: "user-2",
        rfc822MessageId: "shared@vendor.com",
        twins: [{ id: "email-tx-a", userId: "user-1", rfc822MessageId: "shared@vendor.com", purchaseId: canonicalPurchase.id }],
      });

      expect(result.purchaseAction).toBe("created");
      expect(tx.purchase.create).toHaveBeenCalled();
    });

    it("never matches on an absent id", async () => {
      const harness = setupDb();
      db = harness.db;
      const { tx } = harness;

      // Every row written before the migration has a null id. Treating null
      // as a key would collapse an owner's entire history into one purchase.
      const result = await arriveInSecondMailbox(tx, {
        rfc822MessageId: null,
        twins: [{ id: "email-tx-a", userId: "user-1", rfc822MessageId: null, purchaseId: canonicalPurchase.id }],
      });

      expect(tx.emailTransaction.findFirst).not.toHaveBeenCalled();
      expect(result.purchaseAction).toBe("created");
    });

    it("persists the sender-assigned id and the originating connection", async () => {
      const harness = setupDb();
      const { tx } = harness;

      vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
        messageId: "gmail-inbox-b",
        merchant: "Netflix",
        rawSource: "text",
        orderId: undefined,
        totalCents: 1699,
      });
      tx.emailTransaction.findUnique.mockResolvedValue(null);
      tx.emailTransaction.upsert.mockResolvedValue({ ...existingTransaction, purchaseId: null, totalCents: null });
      tx.purchase.findUnique.mockResolvedValue(null);
      tx.purchase.create.mockResolvedValue(canonicalPurchase);
      tx.emailTransaction.update.mockResolvedValue(existingTransaction);

      await processRawGmailMessage(harness.db as never, {
        userId: "user-1",
        message: rawMessage({ messageId: "gmail-inbox-b", rfc822MessageId: "receipt-1@netflix.com" }),
        mode: "scan",
        connectionId: "conn-b",
      });

      expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          rfc822MessageId: "receipt-1@netflix.com",
          connectionId: "conn-b",
        }),
      }));
    });
  });

  describe("order lifecycle dedup", () => {
    type Receipt = {
      messageId: string;
      merchant: string;
      subject: string;
      orderId?: string;
      totalCents?: number;
      currency?: string;
      items?: Array<{ name?: string; quantity?: number; price?: number }>;
    };

    const canonicalPurchase = {
      id: "purchase-simons",
      userId: "user-1",
      merchant: "simons.ca",
      totalCents: 6777,
      currency: "CAD",
      currencySource: "explicitCode",
      purchasedAt: new Date("2026-08-01T12:00:00.000Z"),
      orderNumber: "6777",
      paymentMethod: null,
      category: null,
      categorySource: null,
      source: "GMAIL",
      sourceEmailId: "simons-submitted-a",
      sourceEventId: null,
      possibleDuplicateOfId: null,
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
      updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    };

    function prepareOrderHarness(tx: ReturnType<typeof setupDb>["tx"]) {
      type StoredTransaction = Omit<typeof existingTransaction, "purchaseId"> & {
        purchaseId: string | null;
        connectionId?: string | null;
      };
      const transactions = new Map<string, StoredTransaction>();
      tx.emailTransaction.findUnique.mockResolvedValue(null);
      tx.emailTransaction.upsert.mockImplementation(async ({ create }: {
        create: typeof existingTransaction & { connectionId?: string | null };
      }) => {
        const transaction = {
          ...existingTransaction,
          ...create,
          id: `email-${create.messageId}`,
          purchaseId: null,
        };
        transactions.set(transaction.id, transaction);
        return transaction;
      });
      tx.emailTransaction.update.mockImplementation(async ({ where, data }: {
        where: { id: string };
        data: { purchaseId: string };
      }) => {
        const transaction = { ...transactions.get(where.id)!, ...data };
        transactions.set(where.id, transaction);
        return transaction;
      });
      tx.purchase.findUnique.mockResolvedValue(null);
    }

    async function ingest(
      db: ReturnType<typeof setupDb>["db"],
      receipt: Receipt,
      userId = "user-1",
    ) {
      vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValueOnce({
        ...receipt,
        fromEmail: `orders@${receipt.merchant}`,
        purchasedAt: message.internalDate,
        currencySource: receipt.currency ? "explicitCode" : undefined,
        rawSource: "text",
      });
      return processRawGmailMessage(db as never, {
        userId,
        message: rawMessage({
          messageId: receipt.messageId,
          subject: receipt.subject,
          from: `orders@${receipt.merchant}`,
          // Lifecycle notices are genuinely distinct messages. Their RFC822
          // ids must differ so only the order identity can join them.
          rfc822MessageId: `${receipt.messageId}@${receipt.merchant}`,
        }),
        mode: "scan",
      });
    }

    it("collapses four Simons lifecycle emails into one purchase without erasing its amount or items", async () => {
      const { db, tx } = setupDb();
      prepareOrderHarness(tx);
      tx.purchase.findFirst = orderLookup([]);
      tx.purchase.create.mockResolvedValue(canonicalPurchase);

      const first = await ingest(db, {
        messageId: "simons-submitted-a",
        merchant: "simons.ca",
        subject: "Order successfully submitted",
        orderId: "6777",
        totalCents: 6777,
        currency: "CAD",
        items: [{ name: "Linen shirt", quantity: 1, price: 67.77 }],
      });

      tx.purchase.findFirst = orderLookup([canonicalPurchase]);
      const second = await ingest(db, {
        messageId: "simons-submitted-b",
        merchant: "simons.ca",
        subject: "Order successfully submitted",
        orderId: "6777",
        totalCents: 6777,
        currency: "CAD",
      });
      const third = await ingest(db, {
        messageId: "simons-arrived",
        merchant: "simons.ca",
        subject: "Your order has arrived in store",
        orderId: "6777",
        totalCents: 6777,
        currency: "CAD",
      });
      const fourth = await ingest(db, {
        messageId: "simons-picked-up",
        merchant: "simons.ca",
        subject: "Order picked up in store",
        orderId: "6777",
        // This less-informative lifecycle notice must not clear anything.
        items: [],
      });

      expect([first.purchaseAction, second.purchaseAction, third.purchaseAction, fourth.purchaseAction])
        .toEqual(["created", "linked", "linked", "linked"]);
      expect(tx.purchase.create).toHaveBeenCalledTimes(1);
      expect(tx.purchase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ orderNumber: "6777" }),
      });
      expect(tx.purchase.update).not.toHaveBeenCalled();
      expect(tx.emailTransaction.update).toHaveBeenCalledTimes(4);
      expect(tx.emailTransaction.update).toHaveBeenLastCalledWith({
        where: { id: "email-simons-picked-up" },
        data: { purchaseId: canonicalPurchase.id },
      });
      expect(tx.purchaseItem.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.purchaseItem.createMany).toHaveBeenCalledTimes(1);
      expect(tx.purchaseItem.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          purchaseId: canonicalPurchase.id,
          title: "Linen shirt",
          priceCents: 6777,
        })],
      });
      expect(findMatchingPurchase).toHaveBeenCalledTimes(1);
    });

    it("keeps the same order number at two merchants as two purchases", async () => {
      const { db, tx } = setupDb();
      prepareOrderHarness(tx);
      tx.purchase.findFirst = orderLookup([]);
      tx.purchase.create
        .mockResolvedValueOnce(canonicalPurchase)
        .mockResolvedValueOnce({ ...canonicalPurchase, id: "purchase-vercel", merchant: "vercel.com", sourceEmailId: "vercel-1" });

      await ingest(db, {
        messageId: "simons-submitted-a", merchant: "simons.ca", subject: "submitted",
        orderId: "6777", totalCents: 6777, currency: "CAD",
      });
      tx.purchase.findFirst = orderLookup([canonicalPurchase]);
      const otherMerchant = await ingest(db, {
        messageId: "vercel-1", merchant: "vercel.com", subject: "invoice",
        orderId: "6777", totalCents: 6777, currency: "CAD",
      });

      expect(otherMerchant.purchaseAction).toBe("created");
      expect(tx.purchase.create).toHaveBeenCalledTimes(2);
    });

    it("never links the same merchant and order number across owners", async () => {
      const { db, tx } = setupDb();
      prepareOrderHarness(tx);
      tx.purchase.findFirst = orderLookup([canonicalPurchase]);
      tx.purchase.create.mockResolvedValue({
        ...canonicalPurchase,
        id: "purchase-other-owner",
        userId: "user-2",
        sourceEmailId: "simons-other-owner",
      });

      const otherOwner = await ingest(db, {
        messageId: "simons-other-owner", merchant: "simons.ca", subject: "submitted",
        orderId: "6777", totalCents: 6777, currency: "CAD",
      }, "user-2");

      expect(otherOwner.purchaseAction).toBe("created");
      expect(tx.purchase.create).toHaveBeenCalledTimes(1);
    });

    it("never treats null, empty, or trivial order numbers as merge keys", async () => {
      const { db, tx } = setupDb();
      prepareOrderHarness(tx);
      tx.purchase.findFirst = orderLookup([canonicalPurchase]);
      tx.purchase.create
        .mockResolvedValueOnce({ ...canonicalPurchase, id: "purchase-null", orderNumber: null })
        .mockResolvedValueOnce({ ...canonicalPurchase, id: "purchase-empty", orderNumber: "   " })
        .mockResolvedValueOnce({ ...canonicalPurchase, id: "purchase-trivial", orderNumber: "#-" });

      const absent = await ingest(db, {
        messageId: "missing-order", merchant: "simons.ca", subject: "receipt", totalCents: 6777,
      });
      const empty = await ingest(db, {
        messageId: "empty-order", merchant: "simons.ca", subject: "receipt", orderId: "   ", totalCents: 6777,
      });
      const trivial = await ingest(db, {
        messageId: "trivial-order", merchant: "simons.ca", subject: "receipt", orderId: "#-", totalCents: 6777,
      });

      expect([absent.purchaseAction, empty.purchaseAction, trivial.purchaseAction])
        .toEqual(["created", "created", "created"]);
      expect(tx.purchase.findFirst).not.toHaveBeenCalled();
      expect(tx.purchase.create).toHaveBeenCalledTimes(3);
      for (const [call] of tx.purchase.create.mock.calls) {
        expect(call).toEqual({ data: expect.objectContaining({ orderNumber: null }) });
      }
    });

    it("links but does not overwrite a purchase with an active owner details correction", async () => {
      const { db, tx } = setupDb();
      prepareOrderHarness(tx);
      const correctedPurchase = {
        ...canonicalPurchase,
        totalCents: 7000,
        currency: "USD",
        currencySource: "userOverride",
        category: "dining",
      };
      tx.purchase.findFirst = orderLookup([correctedPurchase]);
      tx.purchaseCorrection.findFirst.mockResolvedValue({ id: "correction-1" });

      const result = await ingest(db, {
        messageId: "simons-late-detail",
        merchant: "simons.ca",
        subject: "Order picked up in store",
        orderId: "6777",
        totalCents: 6777,
        currency: "CAD",
        items: [{ name: "Parser replacement", quantity: 1, price: 67.77 }],
      });

      expect(result.purchaseAction).toBe("linked");
      expect(tx.purchaseCorrection.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          purchaseId: correctedPurchase.id,
          kind: "details",
          undoneAt: null,
        },
        select: { id: true },
      });
      expect(tx.purchase.update).not.toHaveBeenCalled();
      expect(tx.purchaseItem.findFirst).not.toHaveBeenCalled();
      expect(tx.purchaseItem.deleteMany).not.toHaveBeenCalled();
      expect(tx.purchaseItem.createMany).not.toHaveBeenCalled();
    });

    it("fills missing fields and items when a later order email adds evidence", async () => {
      const { db, tx } = setupDb();
      prepareOrderHarness(tx);
      const sparsePurchase = {
        ...canonicalPurchase,
        totalCents: null,
        currency: null,
        currencySource: null,
      };
      const enrichedPurchase = {
        ...sparsePurchase,
        totalCents: 6777,
        currency: "CAD",
        currencySource: "explicitCode",
      };
      tx.purchase.findFirst = orderLookup([sparsePurchase]);
      tx.purchase.update.mockResolvedValue(enrichedPurchase);
      tx.purchaseItem.findFirst.mockResolvedValue(null);

      await ingest(db, {
        messageId: "simons-detail",
        merchant: "simons.ca",
        subject: "Your receipt",
        orderId: "6777",
        totalCents: 6777,
        currency: "CAD",
        items: [{ name: "Linen shirt", quantity: 1, price: 67.77 }],
      });

      expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          items: [{ name: "Linen shirt", quantity: 1, price: 67.77 }],
        }),
      }));
      expect(tx.purchase.update).toHaveBeenCalledWith({
        where: { id: sparsePurchase.id },
        data: expect.objectContaining({
          totalCents: 6777,
          currency: "CAD",
          currencySource: "explicitCode",
        }),
      });
      expect(tx.purchaseItem.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ purchaseId: sparsePurchase.id, title: "Linen shirt" })],
      });
    });
  });

  it("reprocessing repairs a historical guessed CAD projection", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-legacy" };
    const refreshedTransaction = { ...linkedTransaction, currency: null };
    const legacyPurchase = {
      id: "purchase-legacy",
      userId: "user-1",
      merchant: "Example Store",
      totalCents: 4242,
      currency: "CAD",
      purchasedAt: message.internalDate,
      orderNumber: null,
      paymentMethod: null,
      category: null,
      source: "GMAIL",
      sourceEmailId: message.messageId,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Example Store",
      purchasedAt: message.internalDate,
      totalCents: 4242,
      orderId: undefined,
      currency: undefined,
      rawSource: "text",
      textBody: "Order total: $42.42",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(refreshedTransaction);
    tx.purchase.findUnique.mockResolvedValue(legacyPurchase);
    tx.walletEvent.findFirst.mockResolvedValue(null);
    tx.purchase.update.mockResolvedValue({ ...legacyPurchase, currency: null });

    await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(tx.emailTransaction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ currency: null }),
    }));
    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: legacyPurchase.id },
      data: expect.objectContaining({ currency: null }),
    }));
    expect(removeCapAccrual).toHaveBeenCalledWith(tx, `purchase:${legacyPurchase.id}`);
  });

  it("reprocessing keeps a stored order number the re-parse no longer finds", async () => {
    // Unlike a guessed currency, an order number was extracted rather than
    // defaulted, so failing to re-extract it is a parser miss and not evidence
    // the stored value was wrong. A production dry run would have erased 15 of
    // them across Vercel and Anthropic.
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-legacy" };
    const legacyPurchase = {
      id: "purchase-legacy",
      userId: "user-1",
      merchant: "Example Store",
      totalCents: 4242,
      currency: "USD",
      purchasedAt: message.internalDate,
      orderNumber: "2784-3212-9847",
      paymentMethod: null,
      category: null,
      source: "GMAIL",
      sourceEmailId: message.messageId,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Example Store",
      purchasedAt: message.internalDate,
      totalCents: 4242,
      orderId: undefined,
      currency: "USD",
      rawSource: "text",
      textBody: "Order total: $42.42",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue({ ...linkedTransaction, orderId: null });
    tx.purchase.findUnique.mockResolvedValue(legacyPurchase);
    tx.walletEvent.findFirst.mockResolvedValue(null);
    tx.purchase.update.mockResolvedValue(legacyPurchase);

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orderNumber: "2784-3212-9847" }),
    }));
  });

  it("reprocessing still adopts an order number the re-parse does find", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-legacy" };
    const legacyPurchase = {
      id: "purchase-legacy",
      userId: "user-1",
      merchant: "Example Store",
      totalCents: 4242,
      currency: "USD",
      purchasedAt: message.internalDate,
      orderNumber: null,
      paymentMethod: null,
      category: null,
      source: "GMAIL",
      sourceEmailId: message.messageId,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Example Store",
      purchasedAt: message.internalDate,
      totalCents: 4242,
      orderId: "ORD-99321",
      currency: "USD",
      rawSource: "text",
      textBody: "Order total: $42.42",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue({ ...linkedTransaction, orderId: "ORD-99321" });
    tx.purchase.findUnique.mockResolvedValue(legacyPurchase);
    tx.walletEvent.findFirst.mockResolvedValue(null);
    tx.purchase.update.mockResolvedValue(legacyPurchase);

    await processRawGmailMessage(db as never, { userId: "user-1", message, mode: "reprocess" });

    expect(tx.purchase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orderNumber: "ORD-99321" }),
    }));
  });

  it("reprocessing consolidates an already-promoted lifecycle duplicate into the earliest order purchase", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = {
      ...existingTransaction,
      merchant: "simons.ca",
      orderId: "0000097381261",
      totalCents: 6777,
      currency: "CAD",
      purchaseId: "purchase-later",
    };
    const sourcePurchase = {
      id: "purchase-later",
      userId: "user-1",
      merchant: "simons.ca",
      totalCents: 6777,
      currency: "CAD",
      currencySource: "explicitCode",
      purchasedAt: message.internalDate,
      orderNumber: "0000097381261",
      paymentMethod: null,
      category: null,
      categorySource: null,
      source: "GMAIL",
      sourceEmailId: message.messageId,
      sourceEventId: null,
      possibleDuplicateOfId: null,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    };
    const canonicalPurchase = {
      ...sourcePurchase,
      id: "purchase-earliest",
      sourceEmailId: "gmail-earliest",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "simons.ca",
      purchasedAt: message.internalDate,
      orderId: "0000097381261",
      totalCents: 6777,
      currency: "CAD",
      currencySource: "explicitCode",
      rawSource: "text",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.update.mockResolvedValue({
      ...linkedTransaction,
      purchaseId: canonicalPurchase.id,
    });
    tx.purchase.findUnique.mockImplementation(async ({ where, select }) => {
      if (where.id === canonicalPurchase.id) return canonicalPurchase;
      if (where.id === sourcePurchase.id && select) {
        return {
          ...sourcePurchase,
          emailTransactions: [],
          walletEvents: [],
          statementLines: [],
        };
      }
      return sourcePurchase;
    });
    tx.purchase.findFirst = orderLookup([canonicalPurchase]);

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(result.purchaseAction).toBe("linked");
    expect(tx.emailTransaction.update).toHaveBeenCalledWith({
      where: { id: linkedTransaction.id },
      data: { purchaseId: canonicalPurchase.id },
    });
    expect(reverseCapAccrual).toHaveBeenCalledWith(tx, `purchase:${sourcePurchase.id}`);
    expect(tx.purchase.delete).toHaveBeenCalledWith({ where: { id: sourcePurchase.id } });
  });

  it("does not merge or refresh an already-promoted purchase with an owner details correction", async () => {
    const { db, tx } = setupDb();
    const linkedTransaction = { ...existingTransaction, purchaseId: "purchase-corrected" };
    const correctedPurchase = {
      id: "purchase-corrected",
      userId: "user-1",
      merchant: "Owner's merchant",
      totalCents: 7000,
      currency: "USD",
      currencySource: "userOverride",
      purchasedAt: message.internalDate,
      orderNumber: "OWNER-ORDER",
      paymentMethod: null,
      category: "dining",
      categorySource: "user",
      source: "GMAIL",
      sourceEmailId: message.messageId,
      sourceEventId: null,
      possibleDuplicateOfId: null,
    };

    vi.mocked(parsePurchaseFromRawGmailMessage).mockResolvedValue({
      messageId: message.messageId,
      merchant: "Parsed merchant",
      purchasedAt: message.internalDate,
      orderId: "PARSED-ORDER",
      totalCents: 6777,
      currency: "CAD",
      items: [{ name: "Parser replacement" }],
      rawSource: "text",
    });
    tx.emailTransaction.findUnique.mockResolvedValue(linkedTransaction);
    tx.emailTransaction.upsert.mockResolvedValue({
      ...linkedTransaction,
      merchant: "Parsed merchant",
      orderId: "PARSED-ORDER",
      totalCents: 6777,
      currency: "CAD",
      items: [{ name: "Parser replacement" }],
    });
    tx.purchase.findUnique.mockResolvedValue(correctedPurchase);
    tx.purchaseCorrection.findFirst.mockResolvedValue({ id: "correction-1" });

    const result = await processRawGmailMessage(db as never, {
      userId: "user-1",
      message,
      mode: "reprocess",
    });

    expect(result.purchaseAction).toBe("none");
    expect(tx.purchase.findFirst).not.toHaveBeenCalled();
    expect(tx.purchase.update).not.toHaveBeenCalled();
    expect(tx.purchase.delete).not.toHaveBeenCalled();
    expect(tx.purchaseItem.deleteMany).not.toHaveBeenCalled();
  });
});
