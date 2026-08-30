/**
 * runBackfillForOwner.ts
 *
 * Runs the production Gmail backfill chunk repeatedly for an explicit owner.
 * The default is a read-only corpus/progress report. Applying records the
 * owner's request on incomplete Gmail connections, then walks each connection
 * to the 24-month cutoff with the same recoverable lease used by the cron.
 *
 * The receipt parser is server-only, so standalone Node needs React's server
 * condition. Prisma 7 also requires the explicit pg adapter used below.
 *
 *   npx tsx --conditions=react-server scripts/ops/runBackfillForOwner.ts
 *   npx tsx --conditions=react-server scripts/ops/runBackfillForOwner.ts --user <userId>
 *   npx tsx --conditions=react-server scripts/ops/runBackfillForOwner.ts --user <userId> --apply
 *
 * DRY RUN BY DEFAULT. --apply requires one explicit owner and is the consent
 * action: it records backfillRequestedAt before reading historical mail.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const WINDOW_DAYS = 30;
const MAX_MESSAGES = 500;
const LEASE_MS = 5 * 60 * 1_000;
const MAX_CHUNKS_PER_CONNECTION = 1_000;

type Corpus = {
  emailTransactions: number;
  purchases: number;
  gmailPurchases: number;
  missingCurrency: number;
  recurringObligations: number;
};

async function corpusFor(prisma: PrismaClient, userIds: string[]): Promise<Corpus> {
  const where = { userId: { in: userIds } };
  const [emailTransactions, purchases, gmailPurchases, missingCurrency, recurringObligations] =
    await Promise.all([
      prisma.emailTransaction.count({ where }),
      prisma.purchase.count({ where }),
      prisma.purchase.count({ where: { ...where, source: "GMAIL" } }),
      prisma.purchase.count({ where: { ...where, totalCents: { not: null }, currency: null } }),
      prisma.recurringObligation.count({ where }),
    ]);
  return { emailTransactions, purchases, gmailPurchases, missingCurrency, recurringObligations };
}

function printCorpus(label: string, corpus: Corpus): void {
  console.log(
    `${label}: ${corpus.emailTransactions} email transaction(s), ${corpus.purchases} purchase(s) ` +
    `(${corpus.gmailPurchases} Gmail-sourced), ${corpus.recurringObligations} recurring obligation(s); ` +
    `${corpus.missingCurrency} priced purchase(s) still lack currency.`,
  );
}

async function main() {
  if (!process.execArgv.some((argument) => argument === "--conditions=react-server")) {
    throw new Error(
      "The receipt parser is server-only. Run with: npx tsx --conditions=react-server " +
      "scripts/ops/runBackfillForOwner.ts [options]",
    );
  }

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      apply: { type: "boolean", default: false },
      user: { type: "string" },
    },
  });
  const apply = values.apply === true;
  if (apply && !values.user) {
    throw new Error("--apply requires --user <userId>; fleet-wide historical mail reads are forbidden.");
  }

  const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
  dotenv.config({ path: envPath, quiet: true });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  // Import only after dotenv: gmailBackfill reaches src/lib/prisma through the
  // production Gmail client, and that module validates DATABASE_URL at import.
  const [{ runBackfillChunk }, { prisma: appPrisma }] = await Promise.all([
    import("../../src/lib/domain/receipts/gmailBackfill"),
    import("../../src/lib/prisma"),
  ]);

  try {
    const owners = await prisma.user.findMany({
      where: values.user
        ? { id: values.user }
        : { emailConnections: { some: { provider: "GMAIL" } } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        email: true,
        emailConnections: {
          where: { provider: "GMAIL" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            emailAddress: true,
            backfillRequestedAt: true,
            backfillCursor: true,
            backfillCompletedAt: true,
            backfillLockedAt: true,
          },
        },
      },
    });

    if (owners.length === 0) {
      console.log(values.user
        ? `No owner with id ${values.user} has a Gmail connection. Zero messages fetched and nothing written.`
        : "No owners have Gmail connections. Zero messages fetched and nothing written.");
      return;
    }

    const userIds = owners.map((owner) => owner.id);
    console.log(`\nSelected ${owners.length} owner(s) with ${owners.reduce((sum, owner) => sum + owner.emailConnections.length, 0)} Gmail connection(s).`);
    for (const owner of owners) {
      console.log(`  ${owner.id}${owner.email ? ` (${owner.email})` : ""}:`);
      for (const connection of owner.emailConnections) {
        const state = connection.backfillCompletedAt
          ? `complete at ${connection.backfillCompletedAt.toISOString()}`
          : connection.backfillRequestedAt
            ? `requested; cursor=${connection.backfillCursor ?? "today (not started)"}`
            : "not requested";
        console.log(`    ${connection.id} · ${connection.emailAddress} · ${state}`);
      }
    }

    const before = await corpusFor(prisma, userIds);
    printCorpus("Before", before);

    if (!apply) {
      console.log("\nDRY RUN. No Gmail messages were fetched and nothing was written. Re-run with --apply and one --user.\n");
      return;
    }

    let totalProcessed = 0;
    let totalImported = 0;
    for (const owner of owners) {
      for (const selected of owner.emailConnections) {
        if (selected.backfillCompletedAt) {
          console.log(`\n${selected.emailAddress}: already complete; skipped.`);
          continue;
        }

        if (!selected.backfillRequestedAt) {
          await prisma.emailConnection.updateMany({
            where: { id: selected.id, userId: owner.id },
            data: { backfillRequestedAt: new Date() },
          });
          console.log(`\n${selected.emailAddress}: recorded explicit CLI backfill request.`);
        } else {
          console.log(`\n${selected.emailAddress}: resuming requested backfill.`);
        }

        let done = false;
        for (let chunk = 1; chunk <= MAX_CHUNKS_PER_CONNECTION && !done; chunk += 1) {
          const lockId = randomUUID();
          const claimed = await prisma.emailConnection.updateMany({
            where: {
              id: selected.id,
              userId: owner.id,
              backfillCompletedAt: null,
              OR: [
                { backfillLockedAt: null },
                { backfillLockedAt: { lt: new Date(Date.now() - LEASE_MS) } },
              ],
            },
            data: { backfillLockedAt: new Date(), backfillLockId: lockId },
          });
          if (claimed.count === 0) {
            throw new Error(
              `Could not claim ${selected.id}; another backfill worker holds its lease or it completed concurrently`,
            );
          }

          try {
            const result = await runBackfillChunk(prisma, {
              connectionId: selected.id,
              windowDays: WINDOW_DAYS,
              maxMessages: MAX_MESSAGES,
              now: new Date(),
            });
            await prisma.emailConnection.updateMany({
              where: { id: selected.id, backfillLockId: lockId },
              data: { backfillLockedAt: null, backfillLockId: null, lastScanError: null },
            });
            totalProcessed += result.processed;
            totalImported += result.imported;
            done = result.done;
            console.log(
              `  chunk ${chunk}: ${result.windowFrom} -> ${result.windowTo}; ` +
              `processed=${result.processed}, imported=${result.imported}, done=${result.done}`,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await prisma.emailConnection.updateMany({
              where: { id: selected.id, backfillLockId: lockId },
              data: {
                backfillLockedAt: null,
                backfillLockId: null,
                lastScanError: message,
              },
            });
            throw error;
          }
        }
        if (!done) {
          throw new Error(`${selected.id} exceeded ${MAX_CHUNKS_PER_CONNECTION} chunks without completing`);
        }
      }
    }

    const after = await corpusFor(prisma, userIds);
    console.log(`\nBackfill processed ${totalProcessed} message(s) and imported ${totalImported} new transaction(s).`);
    printCorpus("After", after);
    console.log("APPLIED. Historical ingestion and cursor updates were committed.\n");
  } finally {
    await Promise.allSettled([prisma.$disconnect(), appPrisma.$disconnect()]);
  }
}

const isMain = process.argv[1]?.endsWith("runBackfillForOwner.ts") ?? false;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
