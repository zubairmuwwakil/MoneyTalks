/**
 * sweepRecurringForOwner.ts
 *
 * Runs the production recurring-obligation sweep for one or more owners and
 * prints the actual candidates it derives. It is intentionally an operator
 * report, not another detector: candidate detail comes from the same
 * clustering module and persisted fields come from `sweepRecurringObligations`.
 *
 * DRY RUN BY DEFAULT. The real sweep runs inside one transaction which is
 * deliberately rolled back after its report is read. Nothing persists unless
 * `--apply` is present.
 *
 *   npx tsx scripts/ops/sweepRecurringForOwner.ts
 *   npx tsx scripts/ops/sweepRecurringForOwner.ts --user <userId>
 *   npx tsx scripts/ops/sweepRecurringForOwner.ts --user <userId> --apply
 *
 * Without `--user`, dry-run previews every owner with purchases. Applying is
 * deliberately limited to an explicit owner so a diagnostic command cannot
 * silently become a fleet-wide write.
 */

import fs from "node:fs";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { Prisma, PrismaClient, type Prisma as PrismaTypes } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { sweepRecurringObligations, type RecurringSweepResult } from "../../src/lib/domain/recurring/detectRecurring";
import { clusterRecurringPurchases, type ClusteringPurchase } from "../../src/lib/domain/recurring/clustering";

const ALGORITHM_VERSION = 1;
const DEFAULT_TIME_ZONE = "America/Toronto";

type BucketIdentity = {
  userId: string;
  merchantCanonicalId: string;
  currency: string | null;
  discriminator: string;
};

type Identity = BucketIdentity & {
  seriesKey: string;
};

type CandidateSummary = BucketIdentity & {
  cadence: string;
  coverage: number;
  occurrenceCount: number;
  amountPattern: string;
  purchaseIds: string[];
};

type ObligationSummary = Identity & {
  origin: string;
  status: string | null;
  confidence: number;
  confidenceReasons: PrismaTypes.JsonValue;
  purchaseIds: string[];
};

type SweepPreview = {
  userId: string;
  result: RecurringSweepResult;
  candidates: CandidateSummary[];
  obligations: ObligationSummary[];
};

class DryRunRollback extends Error {}

function bucketKey(identity: BucketIdentity): string {
  return JSON.stringify([
    identity.userId,
    identity.merchantCanonicalId,
    identity.currency,
    identity.discriminator,
  ]);
}

// The sweep owns its transaction. During a dry run (or the one outer apply
// transaction), make its nested transaction use the already-open connection.
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

/**
 * This is reporting-only reuse of the sweep's own clustering input. It gives
 * an operator the evidence count and coverage that the persisted obligation
 * deliberately does not cache; it does not implement a second recurrence rule.
 */
async function candidatesForOwner(
  db: PrismaClient,
  userId: string,
  timeZone: string,
): Promise<CandidateSummary[]> {
  const [purchases, persisted] = await Promise.all([
    db.purchase.findMany({
      where: { userId },
      select: {
        id: true,
        userId: true,
        merchant: true,
        totalCents: true,
        currency: true,
        purchasedAt: true,
      },
    }),
    db.recurringObligation.findMany({
      where: { userId },
      select: {
        merchantCanonicalId: true,
        currency: true,
        discriminator: true,
        evidence: {
          where: { excludedByUser: true },
          select: { purchaseId: true },
        },
      },
    }),
  ]);

  const excludedPurchaseIds = new Set(persisted.flatMap(({ evidence }) => (
    evidence.flatMap(({ purchaseId }) => purchaseId ? [purchaseId] : [])
  )));

  const clusteringPurchases: ClusteringPurchase[] = purchases.flatMap((purchase) => {
    // Keep this guard aligned with sweepRecurringObligations. A priced row
    // without currency remains a gap; an entirely unpriced receipt has null as
    // its honest identity, never a guessed unit.
    const currency = purchase.currency?.trim() || null;
    if (!purchase.merchant.trim() || (purchase.totalCents !== null && !currency)) return [];
    if (excludedPurchaseIds.has(purchase.id)) return [];
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

  return clusterRecurringPurchases(clusteringPurchases, timeZone).map((cluster) => ({
    userId: cluster.userId,
    merchantCanonicalId: cluster.canonicalMerchantId,
    currency: cluster.currency,
    discriminator: cluster.discriminator ?? "",
    cadence: cluster.cadence.cadence.type,
    coverage: cluster.cadence.coverage,
    occurrenceCount: cluster.purchases.length,
    amountPattern: cluster.amountPattern.pattern,
    purchaseIds: cluster.purchases.map(({ id }) => id),
  }));
}

function obligationForCandidate(
  candidate: CandidateSummary,
  obligations: readonly ObligationSummary[],
): ObligationSummary | undefined {
  const candidateIds = new Set(candidate.purchaseIds);
  return obligations
    .filter((obligation) => bucketKey(obligation) === bucketKey(candidate))
    .map((obligation) => ({
      obligation,
      overlap: obligation.purchaseIds.reduce((count, id) => count + Number(candidateIds.has(id)), 0),
    }))
    .sort((left, right) => right.overlap - left.overlap || left.obligation.seriesKey.localeCompare(right.obligation.seriesKey))[0]
    ?.obligation;
}

function reasonCodes(value: PrismaTypes.JsonValue): string {
  if (!Array.isArray(value)) return "no reasons stored";
  const codes = value.flatMap((reason) => (
    typeof reason === "object" && reason !== null && "code" in reason && typeof reason.code === "string"
      ? [reason.code]
      : []
  ));
  return codes.length > 0 ? codes.join(", ") : "no reasons stored";
}

function printPreview(previews: SweepPreview[]) {
  for (const preview of previews) {
    const { created, updated, unchanged, skipped } = preview.result;
    console.log(
      `\nOwner ${preview.userId}: ${preview.candidates.length} candidate(s); ` +
      `sweep created=${created}, updated=${updated}, unchanged=${unchanged}, skipped=${skipped}.`,
    );

    if (preview.candidates.length === 0) {
      console.log("  Found 0 recurring candidates. This owner has purchase evidence, but none passed the recurrence rule.");
      continue;
    }

    for (const candidate of preview.candidates) {
      const obligation = obligationForCandidate(candidate, preview.obligations);
      const state = obligation?.origin === "USER"
        ? "owner-created row protected"
        : obligation
          ? `status=${obligation.status ?? "unknown"}; confidence=${obligation.confidence.toFixed(2)}; reasons=${reasonCodes(obligation.confidenceReasons)}`
          : "not persisted by sweep";
      console.log(
        `  ${candidate.merchantCanonicalId} [${candidate.currency}] — ${candidate.cadence}, ` +
        `${candidate.amountPattern}, ${candidate.occurrenceCount} charge(s), coverage ${candidate.coverage.toFixed(2)}; ${state}.`,
      );
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      apply: { type: "boolean", default: false },
      user: { type: "string" },
    },
  });
  const apply = values.apply === true;
  if (apply && !values.user) {
    throw new Error("--apply requires --user <userId>; preview without --user is intentionally read-only.");
  }

  // tsx does not load .env.local. Prisma 7 also requires a driver adapter,
  // so this is intentionally the same construction as the sibling operator.
  const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
  dotenv.config({ path: envPath, quiet: true });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const ownerWhere = values.user
      ? { id: values.user }
      : { purchases: { some: {} } };
    const owners = await prisma.user.findMany({
      where: ownerWhere,
      orderBy: { id: "asc" },
      select: {
        id: true,
        notificationPreference: { select: { timezone: true } },
        _count: { select: { purchases: true, emailTransactions: true } },
      },
    });
    if (owners.length === 0) {
      console.log(values.user
        ? `No user exists with id ${values.user}. Nothing was swept.`
        : "There are no owners with purchases. Nothing was swept.");
      return;
    }

    const userIds = owners.map(({ id }) => id);
    const purchaseWhere = { userId: { in: userIds } };
    const [purchaseTotal, transactionTotal, merchantBuckets] = await Promise.all([
      prisma.purchase.count({ where: purchaseWhere }),
      prisma.emailTransaction.count({ where: purchaseWhere }),
      prisma.purchase.groupBy({
        by: ["userId", "merchant", "currency"],
        where: purchaseWhere,
        _count: { _all: true },
      }),
    ]);
    const merchantCount = new Set(merchantBuckets.map(({ userId, merchant }) => `${userId}\0${merchant}`)).size;
    console.log(
      `\nCorpus: ${owners.length} owner(s), ${purchaseTotal} purchase(s) across ${merchantCount} merchant(s) ` +
      `and ${merchantBuckets.length} merchant/currency bucket(s); ${transactionTotal} email transaction(s).`,
    );
    for (const owner of owners) {
      const merchants = new Set(merchantBuckets
        .filter((bucket) => bucket.userId === owner.id)
        .map((bucket) => bucket.merchant)).size;
      console.log(`  ${owner.id}: ${owner._count.purchases} purchase(s), ${merchants} merchant(s), ${owner._count.emailTransactions} email transaction(s); timezone=${owner.notificationPreference?.timezone || DEFAULT_TIME_ZONE}.`);
    }

    let previews: SweepPreview[] | undefined;
    try {
      await prisma.$transaction(async (transactionDb) => {
        const db = transactionFacade(transactionDb);
        previews = [];
        for (const owner of owners) {
          const timeZone = owner.notificationPreference?.timezone || DEFAULT_TIME_ZONE;
          const candidates = await candidatesForOwner(db, owner.id, timeZone);
          const result = await sweepRecurringObligations(db, {
            userId: owner.id,
            timeZone,
            algorithmVersion: ALGORITHM_VERSION,
          });
          const rows = await transactionDb.recurringObligation.findMany({
            where: { userId: owner.id },
            select: {
              userId: true,
              merchantCanonicalId: true,
              currency: true,
              discriminator: true,
              seriesKey: true,
              origin: true,
              status: true,
              confidence: true,
              confidenceReasons: true,
              evidence: {
                where: { purchaseId: { not: null } },
                select: { purchaseId: true },
              },
            },
          });
          previews.push({
            userId: owner.id,
            result,
            candidates,
            obligations: rows.map(({ evidence, ...row }) => ({
              ...row,
              purchaseIds: evidence.flatMap(({ purchaseId }) => purchaseId ? [purchaseId] : []),
            })),
          });
        }
        if (!apply) throw new DryRunRollback("rollback dry-run preview");
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 120_000,
      });
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }

    if (!previews) throw new Error("Recurring sweep completed without producing a report");
    printPreview(previews);
    console.log(apply
      ? "\nAPPLIED. Derived recurring obligations were committed.\n"
      : "\nDRY RUN. The preview transaction was rolled back; nothing was written.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
