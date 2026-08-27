import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { processRawGmailMessage } from "./gmailReceiptProcessing";
import { parsePurchaseFromRawGmailMessage } from "./gmailPurchaseParser";
import { resolveEmailMerchant } from "./emailMerchant";
import { findMatchingPurchase } from "@/lib/domain/spine/purchaseMerge";
import { removeCapAccrual, reverseCapAccrual } from "@/lib/spine/cap-usage";

vi.mock("./gmailPurchaseParser", () => ({ parsePurchaseFromRawGmailMessage: vi.fn() }));
vi.mock("./emailMerchant", () => ({ resolveEmailMerchant: vi.fn() }));
vi.mock("@/lib/domain/spine/purchaseMerge", () => ({ findMatchingPurchase: vi.fn() }));
vi.mock("@/lib/domain/ownerState", () => ({ ensureOwnerStateRecord: vi.fn() }));
vi.mock("@/lib/spine/cap-usage", () => ({ applyCapAccrual: vi.fn(), removeCapAccrual: vi.fn(), reverseCapAccrual: vi.fn() }));

const message = {
  messageId: "gmail-1",
  raw: Buffer.from("raw MIME"),
  subject: "Old subject",
  from: "orders@example.com",
  internalDate: new Date("2026-08-01T12:00:00.000Z"),
};

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
      upsert: vi.fn(),
      update: vi.fn(),
    },
    purchase: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    purchaseItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    receiptDocument: { findMany: vi.fn() },
    purchaseAttachment: { createMany: vi.fn(), deleteMany: vi.fn() },
    ownerStateRecord: { findUnique: vi.fn(), create: vi.fn() },
    creditCard: { findMany: vi.fn() },
    capAccrual: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    capUsageLedger: { upsert: vi.fn(), update: vi.fn() },
    walletEvent: { findFirst: vi.fn() },
    // The real TransactionClient has this; promotePurchase reads it to find
    // any curated category before falling back to the merchant pack.
    merchantAlias: { findUnique: vi.fn() },
  };
  const db = {
    merchantAlias: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };

  tx.receiptDocument.findMany.mockResolvedValue([]);
  tx.merchantAlias.findUnique.mockResolvedValue(null);
  vi.mocked(resolveEmailMerchant).mockImplementation(async (_db, merchant) => merchant);
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
});
