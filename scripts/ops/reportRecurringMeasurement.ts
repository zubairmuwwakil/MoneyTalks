/**
 * P8 recurring-obligation measurement.
 *
 * Database access is forced into a read-only transaction. The only writes are
 * explicit local evaluation CSVs under docs/private/ (gitignored by policy).
 * The merchant pass is generated first and deliberately omits detector state;
 * the detected-series sheet cannot be generated until every merchant has a
 * yes/no label.
 *
 *   npx tsx --conditions=react-server scripts/ops/reportRecurringMeasurement.ts --prepare-merchants
 *   npx tsx --conditions=react-server scripts/ops/reportRecurringMeasurement.ts --prepare-series
 *   npx tsx --conditions=react-server scripts/ops/reportRecurringMeasurement.ts --report
 *
 * Add --user <userId> when more than one owner has purchases. Add --output
 * <directory> to keep the gitignored evaluation set somewhere else.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import {
  buildMerchantInventory,
  measureDecisionStream,
  measureMerchants,
  measureSeriesPrecision,
  measureSignalContribution,
  merchantEvaluationCsv,
  merchantLabelCoverage,
  parseMerchantEvaluations,
  parseSeriesEvaluations,
  reasonCodes,
  seriesEvaluationCsv,
  seriesLabelCoverage,
  wilsonInterval,
  type DecisionSnapshot,
  type MeasurementPurchase,
  type MeasurementSeries,
  type MerchantEvaluation,
  type SeriesEvaluation,
} from "../../src/lib/domain/recurring/measurement";

const DEFAULT_TIME_ZONE = "America/Toronto";

interface Snapshot {
  userId: string;
  timeZone: string;
  emailTransactionCount: number;
  purchases: MeasurementPurchase[];
  series: MeasurementSeries[];
  decisions: DecisionSnapshot[];
}

function cadenceType(value: Prisma.JsonValue): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "type" in value) {
    const type = value.type;
    if (typeof type === "string" && type.trim()) return type;
  }
  return "UNKNOWN";
}

async function readSnapshot(prisma: PrismaClient, requestedUserId: string | undefined): Promise<Snapshot> {
  return prisma.$transaction(async (db) => {
    // This is a hard database guarantee, not a convention. Any accidental
    // create/update introduced into this report will fail at PostgreSQL.
    await db.$executeRawUnsafe("SET TRANSACTION READ ONLY");

    const owners = await db.user.findMany({
      where: requestedUserId
        ? { id: requestedUserId, purchases: { some: {} } }
        : { purchases: { some: {} } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        notificationPreference: { select: { timezone: true } },
      },
    });
    if (owners.length === 0) {
      throw new Error(requestedUserId
        ? `No owner with purchases exists for --user ${requestedUserId}`
        : "No owner has purchases; there is no corpus to measure");
    }
    if (owners.length > 1) {
      throw new Error(`Found ${owners.length} owners with purchases; pass --user <userId> so evaluation sets never mix owners`);
    }
    const owner = owners[0];

    const [purchases, obligations, emailTransactionCount] = await Promise.all([
      db.purchase.findMany({
        where: { userId: owner.id },
        orderBy: [{ purchasedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          merchant: true,
          totalCents: true,
          currency: true,
          purchasedAt: true,
        },
      }),
      db.recurringObligation.findMany({
        where: { userId: owner.id, origin: "DETECTED" },
        orderBy: [{ merchantCanonicalId: "asc" }, { seriesKey: "asc" }],
        select: {
          seriesKey: true,
          merchantCanonicalId: true,
          currency: true,
          cadence: true,
          confidence: true,
          confidenceReasons: true,
          confirmedAt: true,
          dismissedAt: true,
          dismissReason: true,
          decidedConfidence: true,
          decidedReasons: true,
          evidence: {
            where: { excludedByUser: false },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            select: { purchaseId: true, occurredAt: true },
          },
        },
      }),
      db.emailTransaction.count({ where: { userId: owner.id } }),
    ]);

    const series = obligations.map((obligation): MeasurementSeries => {
      const merchant = obligation.merchantCanonicalId?.trim();
      if (!merchant) throw new Error(`Detected series ${obligation.seriesKey || "<empty>"} has no merchant identity`);
      if (!obligation.seriesKey) throw new Error(`Detected series for ${merchant} has no durable seriesKey`);
      return {
        seriesKey: obligation.seriesKey,
        merchant,
        currency: obligation.currency,
        cadence: cadenceType(obligation.cadence),
        confidence: obligation.confidence,
        reasons: reasonCodes(obligation.confidenceReasons),
        evidencePurchaseIds: obligation.evidence.flatMap(({ purchaseId }) => purchaseId ? [purchaseId] : []),
        evidenceDates: obligation.evidence.map(({ occurredAt }) => occurredAt),
      };
    });
    const decisions = obligations.map((obligation): DecisionSnapshot => ({
      confirmedAt: obligation.confirmedAt,
      dismissedAt: obligation.dismissedAt,
      dismissReason: obligation.dismissReason,
      decidedConfidence: obligation.decidedConfidence,
      decidedReasons: obligation.decidedReasons,
    }));

    return {
      userId: owner.id,
      timeZone: owner.notificationPreference?.timezone || DEFAULT_TIME_ZONE,
      emailTransactionCount,
      purchases,
      series,
      decisions,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 60_000,
  });
}

function readMerchantLabels(file: string): MerchantEvaluation[] {
  return fs.existsSync(file) ? parseMerchantEvaluations(fs.readFileSync(file, "utf8")) : [];
}

function readSeriesLabels(file: string): SeriesEvaluation[] {
  return fs.existsSync(file) ? parseSeriesEvaluations(fs.readFileSync(file, "utf8")) : [];
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function interval(successes: number, total: number): string {
  const value = wilsonInterval(successes, total);
  return value === null ? "n/a" : `${percentage(value.low)}–${percentage(value.high)}`;
}

function printReport(snapshot: Snapshot, merchantFile: string, seriesFile: string): void {
  const inventory = buildMerchantInventory(snapshot.purchases, snapshot.timeZone);
  const merchantLabels = readMerchantLabels(merchantFile);
  const seriesLabels = readSeriesLabels(seriesFile);
  const merchantCoverage = merchantLabelCoverage(inventory, merchantLabels);
  const detectedCoverage = seriesLabelCoverage(snapshot.series, seriesLabels);
  const merchantMetrics = measureMerchants(inventory, merchantLabels, snapshot.series);
  const detectedMetrics = measureSeriesPrecision(snapshot.series, seriesLabels);
  const signals = measureSignalContribution(snapshot.series, seriesLabels);
  const decisions = measureDecisionStream(snapshot.decisions);
  const currentCodes = [...new Set(snapshot.series.flatMap(({ reasons }) => reasons.map(({ code }) => code)))].sort();

  console.log("\nP8 recurring-obligation measurement (database read-only)");
  console.log(`Owner ${snapshot.userId}; timezone=${snapshot.timeZone}`);
  console.log(
    `Corpus: ${snapshot.emailTransactionCount} email transaction(s), ${snapshot.purchases.length} purchase(s), ` +
    `${inventory.length} merchant(s), ${snapshot.series.length} detected series.`,
  );
  console.log(`Current signal codes fired: ${currentCodes.length > 0 ? currentCodes.join(", ") : "none"}.`);

  console.log("\nGround truth — blind merchant pass (merchant-level recall)");
  console.log(`Labels: ${merchantCoverage.labeled}/${merchantCoverage.total} complete; ${merchantCoverage.uncertain} uncertain.`);
  if (!merchantMetrics) {
    console.log(`Precision/recall unavailable until every merchant is yes/no. Missing: ${merchantCoverage.missing.length}.`);
  } else {
    console.log(
      `TP=${merchantMetrics.truePositives}, FP=${merchantMetrics.falsePositives}, ` +
      `FN=${merchantMetrics.falseNegatives}, TN=${merchantMetrics.trueNegatives}.`,
    );
    console.log(
      `Merchant precision=${percentage(merchantMetrics.precision)} ` +
      `(95% CI ${interval(merchantMetrics.truePositives, merchantMetrics.truePositives + merchantMetrics.falsePositives)}); ` +
      `merchant recall=${percentage(merchantMetrics.recall)} ` +
      `(95% CI ${interval(merchantMetrics.truePositives, merchantMetrics.truePositives + merchantMetrics.falseNegatives)}). ` +
      "This does not claim series-level recall.",
    );
  }

  console.log("\nGround truth — detected-series pass (series precision)");
  console.log(`Labels: ${detectedCoverage.labeled}/${detectedCoverage.total} complete; ${detectedCoverage.uncertain} uncertain.`);
  if (!detectedMetrics || !signals) {
    console.log(`Series precision and signal contribution unavailable until every current series is yes/no. Missing: ${detectedCoverage.missing.length}.`);
  } else {
    console.log(
      `TP=${detectedMetrics.truePositives}, FP=${detectedMetrics.falsePositives}; ` +
      `series precision=${percentage(detectedMetrics.precision)} ` +
      `(95% CI ${interval(detectedMetrics.truePositives, detectedMetrics.truePositives + detectedMetrics.falsePositives)}).`,
    );
    console.log("Per-signal prevalence (descriptive only; no tuning on this corpus):");
    for (const signal of signals) {
      console.log(
        `  ${signal.code}: TP ${signal.truePositiveCount}/${detectedMetrics.truePositives} ` +
        `(${percentage(signal.truePositiveRate)}), FP ${signal.falsePositiveCount}/${detectedMetrics.falsePositives} ` +
        `(${percentage(signal.falsePositiveRate)}), difference=${percentage(signal.prevalenceDifference)}.`,
      );
    }
  }

  console.log("\nDecision stream — precision-only and structurally recall-blind");
  console.log(
    `Confirmed=${decisions.confirmed}; detector dismissals=${decisions.detectorDismissals}; ` +
    `preference dismissals excluded=${decisions.preferenceDismissals}; ambiguous dismissals excluded=${decisions.ambiguousDismissals}.`,
  );
  console.log(
    `Decision-stream precision=${percentage(decisions.precision)} ` +
    `(95% CI ${interval(decisions.confirmed, decisions.confirmed + decisions.detectorDismissals)}).`,
  );
  if (decisions.scoreCurve) {
    console.log("Precision by confidence bucket:");
    for (const bucket of decisions.scoreCurve) {
      console.log(`  ${bucket.label}: ${bucket.positives}/${bucket.total} (${percentage(bucket.precision)})`);
    }
  } else {
    console.log(`Confidence curve ${decisions.scoreCurveSuppressedReason}.`);
  }

  console.log("\nProposed target — owner decision, not an enacted threshold");
  console.log(
    "At least 90% detected-series precision over at least 50 independently labeled series, reported with its confidence interval. " +
    "Precision is the launch bar because a false obligation damages trust in the whole review queue; this single inbox is an instrument check, not enough evidence to tune.",
  );
  console.log(`\nEvaluation files: ${merchantFile}; ${seriesFile}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "prepare-merchants": { type: "boolean", default: false },
      "prepare-series": { type: "boolean", default: false },
      report: { type: "boolean", default: false },
      user: { type: "string" },
      output: { type: "string" },
    },
  });
  const modes = [values["prepare-merchants"], values["prepare-series"], values.report].filter(Boolean);
  if (modes.length !== 1) {
    throw new Error("Choose exactly one: --prepare-merchants, --prepare-series, or --report");
  }

  const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
  dotenv.config({ path: envPath, quiet: true });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const snapshot = await readSnapshot(prisma, values.user);
    const outputDirectory = path.resolve(values.output ?? path.join(
      "docs",
      "private",
      "recurring-evaluation",
      snapshot.userId,
    ));
    const merchantFile = path.join(outputDirectory, "merchants.csv");
    const seriesFile = path.join(outputDirectory, "detected-series.csv");
    const inventory = buildMerchantInventory(snapshot.purchases, snapshot.timeZone);

    if (values["prepare-merchants"]) {
      const prior = readMerchantLabels(merchantFile);
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.writeFileSync(merchantFile, merchantEvaluationCsv(inventory, prior), "utf8");
      const coverage = merchantLabelCoverage(inventory, prior);
      console.log(
        `Wrote blind merchant evaluation: ${merchantFile}\n` +
        `${inventory.length} merchant(s); preserved ${coverage.labeled} complete label(s). ` +
        "Fill recurring_label with yes/no (uncertain keeps measurement blocked). Detector state is intentionally absent.",
      );
      return;
    }

    if (values["prepare-series"]) {
      if (!fs.existsSync(merchantFile)) {
        throw new Error(`Merchant evaluation does not exist: ${merchantFile}. Run --prepare-merchants first.`);
      }
      const merchantLabels = readMerchantLabels(merchantFile);
      const coverage = merchantLabelCoverage(inventory, merchantLabels);
      if (!coverage.complete) {
        throw new Error(
          `Blind merchant pass is incomplete (${coverage.labeled}/${coverage.total}); ` +
          `label all merchants yes/no before revealing detected series`,
        );
      }
      const prior = readSeriesLabels(seriesFile);
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.writeFileSync(seriesFile, seriesEvaluationCsv(snapshot.series, snapshot.purchases, prior), "utf8");
      const detectedCoverage = seriesLabelCoverage(snapshot.series, prior);
      console.log(
        `Wrote detected-series evaluation: ${seriesFile}\n` +
        `${snapshot.series.length} current series; preserved ${detectedCoverage.labeled} complete label(s). ` +
        "Fill series_label with yes/no. This pass measures precision, not recall.",
      );
      return;
    }

    printReport(snapshot, merchantFile, seriesFile);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
