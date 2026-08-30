/**
 * reprocessReceipts.ts
 *
 * Replays stored Gmail message ids through the production receipt processor.
 * Raw messages are fetched serially before the database transaction begins.
 * The bounded batch is resumable with --after <EmailTransaction id>.
 *
 * DRY RUN BY DEFAULT. Preview uses the real write path inside one transaction,
 * snapshots the resulting purchase graph, then deliberately rolls it back.
 * Nothing persists unless --apply is present.
 *
 * The production parser is marked `server-only`, so standalone Node must use
 * the same conditional export that Next's server runtime supplies:
 *
 *   npx tsx --conditions=react-server scripts/ops/reprocessReceipts.ts
 *   npx tsx --conditions=react-server scripts/ops/reprocessReceipts.ts --merchant vercel.com
 *   npx tsx --conditions=react-server scripts/ops/reprocessReceipts.ts --conduit paypal.com
 *   npx tsx --conditions=react-server scripts/ops/reprocessReceipts.ts --limit 25 --after <transactionId>
 *   npx tsx --conditions=react-server scripts/ops/reprocessReceipts.ts --user <userId> --apply
 */

import fs from "node:fs";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { Prisma, PrismaClient, type EmailConnection } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import type { GmailPurchaseAction } from "../../src/lib/domain/receipts/gmailReceiptProcessing";
import { conduitForSender } from "../../src/lib/domain/receipts/emailMerchant";
import { clusterRecurringPurchases } from "../../src/lib/domain/recurring/clustering";

const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_SIZE = 100;
const TRANSACTION_TIMEOUT_MS = 120_000;

type PurchaseSnapshot = {
  id: string;
  userId: string;
  merchant: string;
  totalCents: number | null;
  currency: string | null;
  currencySource: string | null;
  purchasedAt: Date;
  orderNumber: string | null;
  paymentMethod: string | null;
  source: string;
  sourceEmailId: string | null;
  sourceEventId: string | null;
  category: string | null;
  categorySource: string | null;
  possibleDuplicateOfId: string | null;
  financialState: string;
  items: Array<{
    title: string;
    qty: number | null;
    priceCents: number | null;
    currency: string | null;
  }>;
};

type EmailLinkSnapshot = {
  id: string;
  messageId: string;
  merchant: string;
  purchaseId: string | null;
};

export type ReprocessSnapshot = {
  totalPurchases: number;
  purchases: PurchaseSnapshot[];
  emailLinks: EmailLinkSnapshot[];
};

type PurchaseUpdate = {
  id: string;
  before: PurchaseSnapshot;
  after: PurchaseSnapshot;
  fields: string[];
};

type PurchaseRelink = {
  transactionId: string;
  messageId: string;
  fromPurchaseId: string | null;
  toPurchaseId: string | null;
};

type RecurringCandidatePreview = {
  key: string;
  label: string;
};

export type MerchantReprocessReport = {
  merchant: string;
  beforeCount: number;
  afterCount: number;
  deleted: PurchaseSnapshot[];
  created: PurchaseSnapshot[];
  updated: PurchaseUpdate[];
  relinked: PurchaseRelink[];
};

export type ReprocessReport = {
  beforeTotal: number;
  afterTotal: number;
  merchants: MerchantReprocessReport[];
};

function recurringCandidatePreviews(
  snapshot: ReprocessSnapshot,
  timeZones: ReadonlyMap<string, string>,
): RecurringCandidatePreview[] {
  const eligible = snapshot.purchases.flatMap((purchase) => {
    const currency = purchase.currency?.trim() || null;
    if (!purchase.merchant.trim() || (purchase.totalCents !== null && !currency)) return [];
    return [{
      id: purchase.id,
      userId: purchase.userId,
      canonicalMerchantId: purchase.merchant,
      discriminator: null,
      currency,
      amountMinor: purchase.totalCents,
      date: purchase.purchasedAt,
    }];
  });

  const byOwner = new Map<string, typeof eligible>();
  for (const purchase of eligible) {
    byOwner.set(purchase.userId, [...(byOwner.get(purchase.userId) ?? []), purchase]);
  }

  return [...byOwner.entries()].flatMap(([userId, purchases]) =>
    clusterRecurringPurchases(purchases, timeZones.get(userId) ?? "America/Toronto").map((cluster) => {
      const amounts = [...new Set(cluster.purchases.map(({ amountMinor }) => amountMinor))];
      const amount = amounts.length === 1 && amounts[0] !== null
        ? `${(amounts[0] / 100).toFixed(2)} ${cluster.currency ?? "currency unknown"}`
        : cluster.amountPattern.pattern;
      const purchaseIds = cluster.purchases.map(({ id }) => id);
      return {
        key: JSON.stringify([
          cluster.userId,
          cluster.canonicalMerchantId,
          cluster.currency,
          cluster.cadence.cadence.type,
          purchaseIds,
        ]),
        label: `${cluster.canonicalMerchantId} [${cluster.currency}] — ` +
          `${cluster.cadence.cadence.type}, ${amount}, ${purchaseIds.length} charge(s), ` +
          `coverage ${cluster.cadence.coverage.toFixed(2)}`,
      };
    }),
  );
}

const purchaseFields = [
  "merchant",
  "totalCents",
  "currency",
  "currencySource",
  "purchasedAt",
  "orderNumber",
  "paymentMethod",
  "source",
  "sourceEmailId",
  "sourceEventId",
  "category",
  "categorySource",
  "possibleDuplicateOfId",
  "financialState",
  "items",
] as const;

function comparable(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  return JSON.stringify(value);
}

function changedFields(before: PurchaseSnapshot, after: PurchaseSnapshot): string[] {
  return purchaseFields.filter((field) => comparable(before[field]) !== comparable(after[field]));
}

/** Pure diff used by the operator and its focused reporting test. */
export function buildReprocessReport(
  before: ReprocessSnapshot,
  after: ReprocessSnapshot,
): ReprocessReport {
  const beforePurchases = new Map(before.purchases.map((purchase) => [purchase.id, purchase]));
  const afterPurchases = new Map(after.purchases.map((purchase) => [purchase.id, purchase]));
  const beforeLinks = new Map(before.emailLinks.map((link) => [link.id, link]));
  const merchantNames = new Set<string>();

  const deleted = before.purchases.filter((purchase) => !afterPurchases.has(purchase.id));
  const created = after.purchases.filter((purchase) => !beforePurchases.has(purchase.id));
  const updated = after.purchases.flatMap((purchase) => {
    const prior = beforePurchases.get(purchase.id);
    if (!prior) return [];
    const fields = changedFields(prior, purchase);
    return fields.length > 0 ? [{ id: purchase.id, before: prior, after: purchase, fields }] : [];
  });
  const relinked = after.emailLinks.flatMap((link) => {
    const prior = beforeLinks.get(link.id);
    if (!prior || prior.purchaseId === link.purchaseId) return [];
    return [{
      transactionId: link.id,
      messageId: link.messageId,
      fromPurchaseId: prior.purchaseId,
      toPurchaseId: link.purchaseId,
    }];
  });

  for (const purchase of [...deleted, ...created]) merchantNames.add(purchase.merchant);
  for (const update of updated) merchantNames.add(update.after.merchant);
  for (const relink of relinked) {
    const merchant = relink.toPurchaseId
      ? afterPurchases.get(relink.toPurchaseId)?.merchant
      : relink.fromPurchaseId
        ? beforePurchases.get(relink.fromPurchaseId)?.merchant
        : undefined;
    if (merchant) merchantNames.add(merchant);
  }

  const countMerchant = (rows: PurchaseSnapshot[], merchant: string) =>
    rows.filter((row) => row.merchant === merchant).length;

  const merchants = [...merchantNames].sort((a, b) => a.localeCompare(b)).map((merchant) => ({
    merchant,
    beforeCount: countMerchant(before.purchases, merchant),
    afterCount: countMerchant(after.purchases, merchant),
    deleted: deleted.filter((purchase) => purchase.merchant === merchant),
    created: created.filter((purchase) => purchase.merchant === merchant),
    updated: updated.filter((update) => update.after.merchant === merchant),
    relinked: relinked.filter((relink) => {
      const name = relink.toPurchaseId
        ? afterPurchases.get(relink.toPurchaseId)?.merchant
        : relink.fromPurchaseId
          ? beforePurchases.get(relink.fromPurchaseId)?.merchant
          : undefined;
      return name === merchant;
    }),
  }));

  return { beforeTotal: before.totalPurchases, afterTotal: after.totalPurchases, merchants };
}

function purchaseLabel(purchase: PurchaseSnapshot): string {
  const amount = purchase.totalCents == null
    ? "amount unknown"
    : `${(purchase.totalCents / 100).toFixed(2)} ${purchase.currency ?? "currency unknown"}`;
  return `${purchase.id} · ${purchase.purchasedAt.toISOString()} · ${amount}`;
}

export function formatReprocessReport(report: ReprocessReport): string {
  const delta = report.afterTotal - report.beforeTotal;
  const lines = [
    `Purchase total: ${report.beforeTotal} -> ${report.afterTotal} (${delta >= 0 ? "+" : ""}${delta}).`,
  ];

  if (report.merchants.length === 0) {
    lines.push("No purchase rows or purchase links would change.");
    return lines.join("\n");
  }

  for (const group of report.merchants) {
    lines.push("", `${group.merchant}: ${group.beforeCount} -> ${group.afterCount}`);
    for (const purchase of group.deleted) lines.push(`  DELETE  ${purchaseLabel(purchase)}`);
    for (const purchase of group.created) lines.push(`  CREATE  ${purchaseLabel(purchase)}`);
    for (const relink of group.relinked) {
      lines.push(
        `  MERGE/RE-LINK  message ${relink.messageId}: ` +
        `${relink.fromPurchaseId ?? "unlinked"} -> ${relink.toPurchaseId ?? "unlinked"}`,
      );
    }
    for (const update of group.updated) {
      const details = update.fields.map((field) => {
        const before = comparable(update.before[field as keyof PurchaseSnapshot]);
        const after = comparable(update.after[field as keyof PurchaseSnapshot]);
        return `${field} ${before} -> ${after}`;
      }).join("; ");
      lines.push(`  UPDATE  ${update.id}: ${details}`);
    }
  }

  return lines.join("\n");
}

function positiveBoundedInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    throw new Error(`${name} must be an integer from 1 to ${MAX_BATCH_SIZE}`);
  }
  return parsed;
}

async function snapshot(
  db: Prisma.TransactionClient,
  userIds: string[],
): Promise<ReprocessSnapshot> {
  const userWhere = { userId: { in: userIds } };
  // Interactive transactions hold one pg connection. Keep these reads serial:
  // pg warns (and pg 9 will reject) concurrent client.query() calls.
  const totalPurchases = await db.purchase.count();
  const purchases = await db.purchase.findMany({
    where: userWhere,
    select: {
      id: true,
      userId: true,
      merchant: true,
      totalCents: true,
      currency: true,
      currencySource: true,
      purchasedAt: true,
      orderNumber: true,
      paymentMethod: true,
      source: true,
      sourceEmailId: true,
      sourceEventId: true,
      category: true,
      categorySource: true,
      possibleDuplicateOfId: true,
      financialState: true,
      items: {
        select: { title: true, qty: true, priceCents: true, currency: true },
      },
    },
  });
  const emailLinks = await db.emailTransaction.findMany({
    where: { ...userWhere, provider: "GMAIL" },
    select: { id: true, messageId: true, merchant: true, purchaseId: true },
  });
  return {
    totalPurchases,
    purchases: purchases as PurchaseSnapshot[],
    emailLinks,
  };
}

function transactionFacade(transactionDb: Prisma.TransactionClient): PrismaClient {
  return new Proxy(transactionDb, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return async (run: (db: Prisma.TransactionClient) => Promise<unknown>) => run(transactionDb);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as PrismaClient;
}

async function authenticateReadOnly(connection: EmailConnection) {
  const [{ google }, { readConnectionSecret }] = await Promise.all([
    import("googleapis"),
    import("../../src/lib/security/emailConnectionSecrets"),
  ]);
  const accessToken = readConnectionSecret(connection.userId, "accessToken", connection.accessToken);
  const refreshToken = readConnectionSecret(connection.userId, "refreshToken", connection.refreshToken);
  if (!accessToken && !refreshToken) return null;
  if (!refreshToken && connection.expiry && connection.expiry.getTime() <= Date.now()) return null;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth2.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken ?? undefined,
    expiry_date: connection.expiry?.getTime(),
  });
  return google.gmail({ version: "v1", auth: oauth2 });
}

class DryRunRollback extends Error {}

async function main() {
  if (!process.execArgv.some((argument) => argument === "--conditions=react-server")) {
    throw new Error(
      "The receipt parser is server-only. Run with: npx tsx --conditions=react-server " +
      "scripts/ops/reprocessReceipts.ts [options]",
    );
  }
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      apply: { type: "boolean", default: false },
      user: { type: "string" },
      merchant: { type: "string" },
      conduit: { type: "string" },
      limit: { type: "string", default: String(DEFAULT_BATCH_SIZE) },
      after: { type: "string" },
    },
  });
  const apply = values.apply === true;
  const limit = positiveBoundedInteger(values.limit!, "--limit");
  if (values.merchant && values.conduit) {
    throw new Error("Choose either --merchant or --conduit, not both.");
  }
  const conduit = values.conduit?.trim().toLowerCase();
  if (conduit && conduitForSender(`operator@${conduit}`)?.domain !== conduit) {
    throw new Error(`Unknown conduit domain: ${values.conduit}`);
  }
  const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
  dotenv.config({ path: envPath, quiet: true });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Prisma 7 rejects a bare new PrismaClient(). Keep this construction aligned
  // with src/lib/prisma.ts and the sibling reconcileMerchantIdentity operator.
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const scopeWhere: Prisma.EmailTransactionWhereInput = {
      provider: "GMAIL",
      ...(values.user ? { userId: values.user } : {}),
      ...(values.merchant
        ? { merchant: { equals: values.merchant, mode: "insensitive" } }
        : {}),
      ...(conduit
        ? { fromEmail: { contains: conduit, mode: "insensitive" } }
        : {}),
    };
    if (values.after) {
      const cursor = await prisma.emailTransaction.findFirst({
        where: { ...scopeWhere, id: values.after },
        select: { id: true },
      });
      if (!cursor) throw new Error(`--after transaction ${values.after} is outside the selected scope`);
    }

    const [totalTransactions, totalPurchases, totalGmailPurchases, rows] = await Promise.all([
      prisma.emailTransaction.count({ where: scopeWhere }),
      prisma.purchase.count(),
      prisma.purchase.count({ where: { source: "GMAIL" } }),
      prisma.emailTransaction.findMany({
        where: scopeWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...(values.after ? { cursor: { id: values.after }, skip: 1 } : {}),
        take: limit + 1,
        select: {
          id: true,
          userId: true,
          messageId: true,
          connectionId: true,
          merchant: true,
        },
      }),
    ]);
    const hasMore = rows.length > limit;
    const transactions = rows.slice(0, limit);

    console.log(
      `\nCorpus: ${totalTransactions} stored Gmail transaction(s) in scope; ` +
      `${totalPurchases} total purchase(s), of which ${totalGmailPurchases} are Gmail-sourced.`,
    );
    console.log(
      `Batch: ${transactions.length}/${totalTransactions} transaction(s)` +
      `${values.merchant ? ` for merchant ${values.merchant}` : ""}` +
      `${conduit ? ` from conduit ${conduit}` : ""}` +
      `${values.user ? ` for user ${values.user}` : ""}.`,
    );

    if (transactions.length === 0) {
      console.log("No stored Gmail messages selected. Zero messages fetched and nothing written.\n");
      return;
    }

    const userIds = [...new Set(transactions.map((row) => row.userId))];
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, timezone: true },
    });
    const timeZones = new Map(preferences.map(({ userId, timezone }) => [userId, timezone]));
    const connections = await prisma.emailConnection.findMany({
      where: { userId: { in: userIds }, provider: "GMAIL" },
      orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
    });
    const connectionsByUser = new Map<string, EmailConnection[]>();
    for (const connection of connections) {
      connectionsByUser.set(connection.userId, [
        ...(connectionsByUser.get(connection.userId) ?? []),
        connection,
      ]);
    }

    const { hasGmailReadScope, listRecentRawGmailMessages } =
      await import("../../src/lib/services/gmailScanSource");
    const authByConnection = new Map<string, ReturnType<typeof authenticateReadOnly>>();
    const authenticate = (connection: EmailConnection) => {
      const cached = authByConnection.get(connection.id);
      if (cached) return cached;
      const pending = authenticateReadOnly(connection);
      authByConnection.set(connection.id, pending);
      return pending;
    };

    const fetched: Array<{
      transaction: (typeof transactions)[number];
      connectionId: string;
      message: Awaited<ReturnType<typeof listRecentRawGmailMessages>>[number];
    }> = [];
    const fetchErrors: Array<{ messageId: string; error: string }> = [];
    for (const [index, transaction] of transactions.entries()) {
      const allCandidates = connectionsByUser.get(transaction.userId) ?? [];
      const candidates = transaction.connectionId
        ? allCandidates.filter((connection) => connection.id === transaction.connectionId)
        : allCandidates;
      let fetchedMessage: (typeof fetched)[number]["message"] | undefined;
      let matchedConnectionId: string | undefined;
      let lastError: unknown = new Error("Originating Gmail connection not found");

      for (const connection of candidates) {
        try {
          if (!hasGmailReadScope(connection.scope)) throw new Error("gmail_scope_missing");
          const gmail = await authenticate(connection);
          if (!gmail) throw new Error("not_connected");
          const [message] = await listRecentRawGmailMessages(gmail as never, {
            messageIds: [transaction.messageId],
          });
          if (!message) throw new Error("Raw Gmail message not found");
          fetchedMessage = message;
          matchedConnectionId = connection.id;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (fetchedMessage && matchedConnectionId) {
        fetched.push({ transaction, connectionId: matchedConnectionId, message: fetchedMessage });
      } else {
        fetchErrors.push({
          messageId: transaction.messageId,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
      }
      if ((index + 1) % 10 === 0 || index + 1 === transactions.length) {
        console.log(`Fetched ${index + 1}/${transactions.length} raw Gmail message(s).`);
      }
    }

    const purchaseActions: Record<GmailPurchaseAction, number> = {
      none: 0,
      created: 0,
      updated: 0,
      linked: 0,
      deleted: 0,
      unlinked: 0,
    };
    const parserErrors: Array<{ messageId: string; error: string }> = [];
    let report: ReprocessReport | undefined;
    let addedRecurringCandidates: RecurringCandidatePreview[] = [];

    try {
      await prisma.$transaction(async (transactionDb) => {
        const before = await snapshot(transactionDb, userIds);
        const beforeRecurring = new Set(recurringCandidatePreviews(before, timeZones).map(({ key }) => key));
        const replayDb = transactionFacade(transactionDb);
        const { processRawGmailMessage } =
          await import("../../src/lib/domain/receipts/gmailReceiptProcessing");

        for (const entry of fetched) {
          const result = await processRawGmailMessage(replayDb, {
            userId: entry.transaction.userId,
            message: entry.message,
            mode: "reprocess",
            connectionId: entry.connectionId,
          });
          purchaseActions[result.purchaseAction]++;
          if (result.parserError) {
            parserErrors.push({ messageId: entry.transaction.messageId, error: result.parserError });
          }
        }

        const after = await snapshot(transactionDb, userIds);
        report = buildReprocessReport(before, after);
        addedRecurringCandidates = recurringCandidatePreviews(after, timeZones)
          .filter(({ key }) => !beforeRecurring.has(key));
        if (!apply) throw new DryRunRollback("rollback dry-run preview");
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: TRANSACTION_TIMEOUT_MS,
      });
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }

    if (!report) throw new Error("Reprocess completed without producing a report");
    console.log("\n" + formatReprocessReport(report));
    if (addedRecurringCandidates.length > 0) {
      console.log("\nNew recurring candidate(s) in the replayed Purchase graph:");
      for (const candidate of addedRecurringCandidates) console.log(`  ${candidate.label}`);
    } else {
      console.log("\nNo new recurring candidate surfaces in the replayed Purchase graph.");
    }
    console.log(
      "\nProcessor actions: " +
      Object.entries(purchaseActions).map(([action, count]) => `${action}=${count}`).join(", ") + ".",
    );
    if (fetchErrors.length > 0) {
      console.log(`\n${fetchErrors.length} Gmail fetch error(s); those messages were not reprocessed:`);
      for (const error of fetchErrors) console.log(`  ${error.messageId}: ${error.error}`);
    }
    if (parserErrors.length > 0) {
      console.log(`\n${parserErrors.length} parser error(s); prior purchase projections were preserved:`);
      for (const error of parserErrors) console.log(`  ${error.messageId}: ${error.error}`);
    }

    if (hasMore) {
      const nextCursor = transactions.at(-1)!.id;
      console.log(`\nMore rows remain. Resume with --after ${nextCursor}.`);
    }
    console.log(apply
      ? `\nAPPLIED. Purchase total committed at ${report.afterTotal}.\n`
      : "\nDRY RUN. The preview transaction was rolled back; nothing was written.\n");
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1]?.endsWith("reprocessReceipts.ts") ?? false;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
