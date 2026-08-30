import { Prisma, type PrismaClient } from "@prisma/client";

import { occurrencesBetween } from "@/engine/recurrence";
import { clusterRecurringPurchases, type CandidateCluster, type ClusteringPurchase } from "./clustering";
import { scoreRecurringConfidence } from "./confidence";
import { extractEmailSignals } from "./emailSignals";
import { deriveObligationStatus } from "./lifecycle";
import type { ObligationFact } from "./types";

export interface RecurringSweepArgs {
  userId: string;
  timeZone: string;
  algorithmVersion: number;
}

export interface RecurringSweepResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

type SweepOutcome = Exclude<keyof RecurringSweepResult, "skipped"> | "skipped";

type PersistedIdentity = {
  userId: string;
  merchantCanonicalId: string;
  currency: string | null;
  discriminator: string;
};

type ExcludedEvidence = {
  purchaseId: string | null;
  emailTransactionId: string | null;
};

type SweepEmail = {
  id: string;
  merchant: string;
  subject: string | null;
  purchasedAt: Date | null;
  createdAt: Date;
};

type EmailFact = {
  email: SweepEmail;
  fact: ObligationFact;
};

function identityKey(identity: PersistedIdentity): string {
  return JSON.stringify([
    identity.userId,
    identity.merchantCanonicalId,
    identity.currency,
    identity.discriminator,
  ]);
}

function localIsoDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new RangeError(`could not read ${type} from sweep date`);
    return value;
  };
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function addDays(iso: string, days: number): string {
  const result = new Date(`${iso}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function nextExpectedDate(cluster: CandidateCluster, asOf: Date, timeZone: string): Date | null {
  const today = localIsoDate(asOf, timeZone);
  const next = occurrencesBetween(cluster.cadence.cadence, today, addDays(today, 90))[0];
  return next ? new Date(`${next}T12:00:00.000Z`) : null;
}

function evidenceRole(fact: ObligationFact): "CADENCE_FACT" | "CANCELLATION" | "TRIAL" | "PRICE_CHANGE" {
  switch (fact.type) {
    case "CANCELLATION":
      return "CANCELLATION";
    case "TRIAL_STARTED":
    case "TRIAL_ENDED":
      return "TRIAL";
    case "PRICE_CHANGE":
      return "PRICE_CHANGE";
    case "EXPLICIT_CADENCE":
    case "EXPLICIT_RECURRING":
    case "NEXT_BILLING_DATE":
      return "CADENCE_FACT";
    case "CHARGE":
      throw new RangeError("charge facts are linked through purchase evidence");
    default: {
      const exhaustive: never = fact;
      return exhaustive;
    }
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Sweep the canonical Purchase spine into persisted recurring obligations.
 * Merchant identity and currency are consumed exactly as ingestion stored
 * them; this boundary deliberately performs no second resolution pass.
 */
export async function sweepRecurringObligations(
  db: PrismaClient,
  args: RecurringSweepArgs,
): Promise<RecurringSweepResult> {
  if (!args.userId.trim()) throw new RangeError("userId must be a non-empty string");
  if (!Number.isSafeInteger(args.algorithmVersion) || args.algorithmVersion < 1) {
    throw new RangeError("algorithmVersion must be a positive safe integer");
  }

  const [purchaseRows, emailRows, persisted] = await Promise.all([
    db.purchase.findMany({
      where: { userId: args.userId },
      select: {
        id: true,
        userId: true,
        merchant: true,
        totalCents: true,
        currency: true,
        purchasedAt: true,
      },
    }),
    db.emailTransaction.findMany({
      where: { userId: args.userId },
      select: {
        id: true,
        merchant: true,
        subject: true,
        purchasedAt: true,
        createdAt: true,
      },
    }),
    db.recurringObligation.findMany({
      where: { userId: args.userId },
      select: {
        userId: true,
        merchantCanonicalId: true,
        currency: true,
        discriminator: true,
        evidence: {
          where: { excludedByUser: true },
          select: { purchaseId: true, emailTransactionId: true },
        },
      },
    }),
  ]);

  const exclusionsByIdentity = new Map<string, ExcludedEvidence[]>();
  for (const obligation of persisted) {
    exclusionsByIdentity.set(identityKey(obligation), obligation.evidence);
  }

  let skipped = 0;
  const purchases: ClusteringPurchase[] = [];
  for (const purchase of purchaseRows) {
    // Currency is part of identity. A priced receipt without one remains
    // unclusterable: guessing it would merge obligations billed in different
    // units. An entirely unpriced receipt is different — no amount means no
    // currency is honestly knowable, so its null is a valid identity.
    const currency = purchase.currency?.trim() || null;
    if (!purchase.merchant.trim() || (purchase.totalCents !== null && !currency)) {
      skipped += 1;
      continue;
    }
    const key = identityKey({
      userId: purchase.userId,
      merchantCanonicalId: purchase.merchant,
      currency,
      discriminator: "",
    });
    const excluded = exclusionsByIdentity.get(key) ?? [];
    if (excluded.some((evidence) => evidence.purchaseId === purchase.id)) {
      skipped += 1;
      continue;
    }
    purchases.push({
      id: purchase.id,
      userId: purchase.userId,
      canonicalMerchantId: purchase.merchant,
      discriminator: null,
      currency,
      amountMinor: purchase.totalCents,
      date: purchase.purchasedAt,
    });
  }

  const clusters = clusterRecurringPurchases(purchases, args.timeZone);
  const result: RecurringSweepResult = { created: 0, updated: 0, unchanged: 0, skipped };
  const asOf = new Date();

  for (const cluster of clusters) {
    const identity: PersistedIdentity = {
      userId: cluster.userId,
      merchantCanonicalId: cluster.canonicalMerchantId,
      currency: cluster.currency,
      discriminator: cluster.discriminator ?? "",
    };
    const excluded = exclusionsByIdentity.get(identityKey(identity)) ?? [];
    const excludedEmailIds = new Set(excluded.flatMap(({ emailTransactionId }) => emailTransactionId ? [emailTransactionId] : []));
    const emailFacts: EmailFact[] = emailRows
      .filter((email) => email.merchant === cluster.canonicalMerchantId && !excludedEmailIds.has(email.id))
      .flatMap((email) => extractEmailSignals([email]).map((fact) => ({ email, fact })));
    const facts: ObligationFact[] = [
      ...cluster.purchases.map((purchase) => ({ type: "CHARGE" as const, occurredAt: purchase.date })),
      ...emailFacts.map(({ fact }) => fact),
    ];
    const confidence = scoreRecurringConfidence(cluster, facts);
    const status = deriveObligationStatus(facts, cluster.cadence.cadence, asOf);
    const projectedDate = nextExpectedDate(cluster, asOf, args.timeZone);
    const lastObservedAt = cluster.purchases.at(-1)!.date;
    const derived = {
      cadence: cluster.cadence.cadence as Prisma.InputJsonValue,
      schedule: cluster.amountPattern.schedule as unknown as Prisma.InputJsonValue,
      amountPattern: cluster.amountPattern.pattern,
      status,
      nextExpectedDate: projectedDate,
      confidence: confidence.score,
      confidenceReasons: confidence.reasons as unknown as Prisma.InputJsonValue,
      lastObservedAt,
      algorithmVersion: args.algorithmVersion,
    };

    const evidence = [
      ...cluster.purchases.map((purchase) => ({
        purchaseId: purchase.id,
        emailTransactionId: null,
        role: "OCCURRENCE" as const,
        excludedByUser: false,
        occurredAt: purchase.date,
      })),
      ...[...new Map(emailFacts.map(({ email, fact }) => {
        const role = evidenceRole(fact);
        return [`${email.id}\0${role}`, {
          purchaseId: null,
          emailTransactionId: email.id,
          role,
          excludedByUser: false,
          occurredAt: fact.occurredAt,
        }] as const;
      })).values()],
    ];

    const persist = async (): Promise<SweepOutcome> => db.$transaction(async (tx) => {
      const existing = await tx.recurringObligation.findFirst({
        where: identity,
      });
      if (existing?.origin === "USER") return "skipped";

      let obligationId: string;
      let outcome: SweepOutcome;
      if (!existing) {
        const created = await tx.recurringObligation.create({
          data: {
            ...identity,
            ...derived,
            needsReview: true,
            origin: "DETECTED",
          },
        });
        obligationId = created.id;
        outcome = "created";
      } else {
        obligationId = existing.id;
        const unchanged = (
          jsonEqual(existing.cadence, derived.cadence)
          && jsonEqual(existing.schedule, derived.schedule)
          && existing.amountPattern === derived.amountPattern
          && existing.status === derived.status
          && sameDate(existing.nextExpectedDate, derived.nextExpectedDate)
          && existing.confidence === derived.confidence
          && jsonEqual(existing.confidenceReasons, derived.confidenceReasons)
          && existing.lastObservedAt.getTime() === derived.lastObservedAt.getTime()
          && existing.algorithmVersion === derived.algorithmVersion
        );
        if (unchanged) {
          outcome = "unchanged";
        } else {
          const updated = await tx.recurringObligation.updateMany({
            where: { id: existing.id, origin: { not: "USER" } },
            data: derived,
          });
          if (updated.count === 0) return "skipped";
          outcome = "updated";
        }
      }

      // Owner-excluded rows survive untouched. All detector-owned links are a
      // replace-set, so reruns cannot accumulate duplicates.
      await tx.recurringObligationEvidence.deleteMany({
        where: { obligationId, excludedByUser: false },
      });
      if (evidence.length > 0) {
        await tx.recurringObligationEvidence.createMany({
          data: evidence.map((row) => ({ obligationId, ...row })),
        });
      }
      return outcome;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    let outcome: SweepOutcome;
    try {
      outcome = await persist();
    } catch (error) {
      // A concurrent first sweep can win the unique identity race. Re-read and
      // take the ordinary update/owner-protection path once.
      if (!isUniqueViolation(error)) throw error;
      outcome = await persist();
    }
    result[outcome] += 1;
  }

  return result;
}
