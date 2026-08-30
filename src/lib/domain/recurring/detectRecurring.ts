import { Prisma, type EmailFactType, type PrismaClient } from "@prisma/client";

import { occurrencesBetween, type Cadence } from "@/engine/recurrence";
import { clusterRecurringPurchases, type CandidateCluster, type ClusteringPurchase } from "./clustering";
import { hasSufficientRecurringEvidence, scoreRecurringConfidence } from "./confidence";
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
  seriesKey: string;
};

type ExcludedEvidence = {
  purchaseId: string | null;
  emailTransactionId: string | null;
  emailFactId: string | null;
  excludedByUser: boolean;
};

type PersistedSeries = PersistedIdentity & {
  id: string;
  origin: "DETECTED" | "EMAIL_STATED" | "USER" | "MIGRATED";
  evidence: ExcludedEvidence[];
};

type SweepCandidate = {
  cluster: CandidateCluster;
  emailFactIds: Set<string>;
  origin: "DETECTED" | "EMAIL_STATED";
  seriesKeySeed: string;
};

type ResolvedCluster = {
  cluster: CandidateCluster;
  origin: SweepCandidate["origin"];
  identity: PersistedIdentity;
  persisted: PersistedSeries | null;
  protectedByOwner: boolean;
};

type SweepEmailFact = {
  id: string;
  emailTransactionId: string;
  type: EmailFactType;
  occurredAt: Date;
  effectiveAt: Date | null;
  billingAt: Date | null;
  amountMinor: number | null;
  currency: string | null;
  cadence: string | null;
  emailTransaction: {
    id: string;
    merchant: string;
  };
};

type EmailFact = {
  source: SweepEmailFact;
  fact: ObligationFact;
};

const CADENCE_TYPES = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]);

/** Map the persistence union back to the existing domain union without widening it. */
function toObligationFact(row: SweepEmailFact): ObligationFact | null {
  switch (row.type) {
    case "EXPLICIT_CADENCE":
      if (!row.cadence || !CADENCE_TYPES.has(row.cadence)) return null;
      return {
        type: row.type,
        occurredAt: row.occurredAt,
        cadence: row.cadence as Extract<ObligationFact, { type: "EXPLICIT_CADENCE" }>["cadence"],
      };
    case "EXPLICIT_RECURRING":
      return { type: row.type, occurredAt: row.occurredAt };
    case "CANCELLATION":
    case "TRIAL_STARTED":
    case "TRIAL_ENDED":
      return { type: row.type, occurredAt: row.occurredAt, effectiveAt: row.effectiveAt ?? undefined };
    case "PRICE_CHANGE":
      return {
        type: row.type,
        occurredAt: row.occurredAt,
        effectiveAt: row.effectiveAt ?? undefined,
        amountMinor: row.amountMinor ?? undefined,
      };
    case "NEXT_BILLING_DATE":
      return row.billingAt
        ? { type: row.type, occurredAt: row.occurredAt, billingAt: row.billingAt }
        : null;
    default: {
      const exhaustive: never = row.type;
      return exhaustive;
    }
  }
}

function identityKey(identity: PersistedIdentity): string {
  return JSON.stringify([
    identity.userId,
    identity.merchantCanonicalId,
    identity.currency,
    identity.discriminator,
    identity.seriesKey,
  ]);
}

function bucketKey(identity: Omit<PersistedIdentity, "seriesKey">): string {
  return JSON.stringify([
    identity.userId,
    identity.merchantCanonicalId,
    identity.currency,
    identity.discriminator,
  ]);
}

/**
 * Reconcile this sweep's mutable clusters to durable series identities.
 *
 * Evidence overlap preserves an existing key when a charge is appended,
 * cadence inference shifts, or older evidence is backfilled. Only a genuinely
 * unmatched series receives a new key, seeded from its earliest occurrence so
 * concurrent first sweeps converge on the same unique identity.
 */
function resolveSeries(
  candidates: readonly SweepCandidate[],
  persisted: readonly PersistedSeries[],
): ResolvedCluster[] {
  const clusters = candidates.map(({ cluster }) => cluster);
  const clusterBuckets = clusters.map((cluster) => bucketKey({
    userId: cluster.userId,
    merchantCanonicalId: cluster.canonicalMerchantId,
    currency: cluster.currency,
    discriminator: cluster.discriminator ?? "",
  }));
  const ownerBuckets = new Set(persisted
    .filter(({ origin }) => origin === "USER")
    .map((row) => bucketKey(row)));
  const clusterPurchaseIds = clusters.map((cluster) => new Set(cluster.purchases.map(({ id }) => id)));
  const edges = persisted
    .filter(({ origin }) => origin !== "USER")
    .flatMap((row) => clusters.flatMap((cluster, clusterIndex) => {
      if (bucketKey(row) !== clusterBuckets[clusterIndex]) return [];
      const overlap = row.evidence.reduce((count, evidence) => {
        if (evidence.purchaseId && clusterPurchaseIds[clusterIndex].has(evidence.purchaseId)) return count + 1;
        if (evidence.emailFactId && candidates[clusterIndex].emailFactIds.has(evidence.emailFactId)) return count + 1;
        return count;
      }, 0);
      return overlap > 0 ? [{ clusterIndex, overlap, row }] : [];
    }))
    .sort((left, right) => (
      right.overlap - left.overlap
      || candidates[left.clusterIndex].seriesKeySeed.localeCompare(candidates[right.clusterIndex].seriesKeySeed)
      || left.row.id.localeCompare(right.row.id)
    ));

  const matchedByCluster = new Map<number, PersistedSeries>();
  const matchedRowIds = new Set<string>();
  for (const edge of edges) {
    if (matchedByCluster.has(edge.clusterIndex) || matchedRowIds.has(edge.row.id)) continue;
    matchedByCluster.set(edge.clusterIndex, edge.row);
    matchedRowIds.add(edge.row.id);
  }

  const resolved = clusters.map((cluster, clusterIndex): ResolvedCluster => {
    const matched = matchedByCluster.get(clusterIndex) ?? null;
    const protectedByOwner = ownerBuckets.has(clusterBuckets[clusterIndex]);
    return {
      cluster,
      origin: candidates[clusterIndex].origin,
      persisted: matched,
      protectedByOwner,
      identity: {
        userId: cluster.userId,
        merchantCanonicalId: cluster.canonicalMerchantId,
        currency: cluster.currency,
        discriminator: cluster.discriminator ?? "",
        seriesKey: matched?.seriesKey ?? candidates[clusterIndex].seriesKeySeed,
      },
    };
  });

  const assigned = new Set<string>();
  for (const resolution of resolved) {
    if (resolution.protectedByOwner) continue;
    const key = identityKey(resolution.identity);
    if (assigned.has(key)) {
      throw new Error(`recurring series identity collision: ${key}`);
    }
    assigned.add(key);
  }
  return resolved;
}

function emailStatedCadence(type: Cadence["type"], anchor: Date): Cadence {
  const iso = anchor.toISOString().slice(0, 10);
  if (type === "MONTHLY") return { type, dayOfMonth: anchor.getUTCDate(), startsFrom: iso };
  return { type, anchor: iso };
}

function emailStatedCandidates(
  rows: readonly SweepEmailFact[],
  userId: string,
  merchantsWithCharges: ReadonlySet<string>,
): SweepCandidate[] {
  const groups = new Map<string, EmailFact[]>();
  for (const source of rows) {
    const merchant = source.emailTransaction.merchant.trim();
    const fact = toObligationFact(source);
    if (!merchant || !fact || merchantsWithCharges.has(merchant)) continue;
    const group = groups.get(merchant) ?? [];
    group.push({ source, fact });
    groups.set(merchant, group);
  }

  const candidates: SweepCandidate[] = [];
  for (const [merchant, emailFacts] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = [...emailFacts].sort((left, right) => (
      left.fact.occurredAt.getTime() - right.fact.occurredAt.getTime()
      || left.source.id.localeCompare(right.source.id)
    ));
    const facts = ordered.map(({ fact }) => fact);
    if (!hasSufficientRecurringEvidence(0, facts)) continue;

    const cadenceEvidence = ordered.findLast(({ fact }) => fact.type === "EXPLICIT_CADENCE");
    if (!cadenceEvidence || cadenceEvidence.fact.type !== "EXPLICIT_CADENCE") continue;
    const billingEvidence = ordered.findLast(({ fact }) => fact.type === "NEXT_BILLING_DATE");
    const billingAt = billingEvidence?.fact.type === "NEXT_BILLING_DATE" ? billingEvidence.fact.billingAt : null;
    const amountEvidence = ordered.findLast(({ fact }) => "amountMinor" in fact && fact.amountMinor !== undefined);
    const amountMinor = amountEvidence?.fact.type === "PRICE_CHANGE" ? amountEvidence.fact.amountMinor ?? null : null;
    const currency = amountMinor === null ? null : amountEvidence?.source.currency?.trim() || null;
    const anchor = billingAt ?? cadenceEvidence.fact.occurredAt;
    const schedule = amountMinor === null ? [] : [{
      amountMinor,
      from: (
        amountEvidence?.fact.type === "PRICE_CHANGE" && amountEvidence.fact.effectiveAt
          ? amountEvidence.fact.effectiveAt
          : amountEvidence!.fact.occurredAt
      ).toISOString().slice(0, 10),
    }];

    candidates.push({
      cluster: {
        userId,
        canonicalMerchantId: merchant,
        currency,
        discriminator: null,
        purchases: [],
        cadence: { cadence: emailStatedCadence(cadenceEvidence.fact.cadence, anchor), coverage: 0, mad: 0 },
        // A stated amount is not an observed pattern. Keeping UNKNOWN also
        // prevents FIXED_AMOUNT from inflating the email-only confidence ceiling.
        amountPattern: { pattern: "UNKNOWN", schedule },
      },
      emailFactIds: new Set(ordered.map(({ source }) => source.id)),
      origin: "EMAIL_STATED",
      seriesKeySeed: `email:${ordered[0].source.id}`,
    });
  }
  return candidates;
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

  const [purchaseRows, emailFactRows, persisted] = await Promise.all([
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
    db.emailObligationFact.findMany({
      where: { userId: args.userId },
      select: {
        id: true,
        emailTransactionId: true,
        type: true,
        occurredAt: true,
        effectiveAt: true,
        billingAt: true,
        amountMinor: true,
        currency: true,
        cadence: true,
        emailTransaction: {
          select: {
            id: true,
            merchant: true,
          },
        },
      },
    }),
    db.recurringObligation.findMany({
      where: { userId: args.userId },
      select: {
        id: true,
        userId: true,
        merchantCanonicalId: true,
        currency: true,
        discriminator: true,
        seriesKey: true,
        origin: true,
        evidence: {
          select: { purchaseId: true, emailTransactionId: true, emailFactId: true, excludedByUser: true },
        },
      },
    }),
  ]);

  const excludedPurchaseIds = new Set(persisted.flatMap(({ evidence }) => evidence.flatMap((item) => (
    item.excludedByUser && item.purchaseId ? [item.purchaseId] : []
  ))));

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
    if (excludedPurchaseIds.has(purchase.id)) {
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

  const emailFactIdsByMerchant = new Map<string, Set<string>>();
  for (const row of emailFactRows) {
    const merchant = row.emailTransaction.merchant;
    const ids = emailFactIdsByMerchant.get(merchant) ?? new Set<string>();
    ids.add(row.id);
    emailFactIdsByMerchant.set(merchant, ids);
  }
  const chargeCandidates: SweepCandidate[] = clusterRecurringPurchases(purchases, args.timeZone).map((cluster) => ({
    cluster,
    emailFactIds: emailFactIdsByMerchant.get(cluster.canonicalMerchantId) ?? new Set<string>(),
    origin: "DETECTED",
    seriesKeySeed: `purchase:${cluster.purchases[0].id}`,
  }));
  const merchantsWithCharges = new Set(purchaseRows.map(({ merchant }) => merchant.trim()).filter(Boolean));
  const candidates = [
    ...chargeCandidates,
    ...emailStatedCandidates(emailFactRows, args.userId, merchantsWithCharges),
  ];
  const result: RecurringSweepResult = { created: 0, updated: 0, unchanged: 0, skipped };
  const asOf = new Date();

  for (const resolution of resolveSeries(candidates, persisted)) {
    const { cluster, identity } = resolution;
    if (resolution.protectedByOwner) {
      result.skipped += 1;
      continue;
    }
    const excluded = resolution.persisted?.evidence.filter(({ excludedByUser }) => excludedByUser) ?? [];
    const excludedFactIds = new Set(excluded.flatMap(({ emailFactId }) => emailFactId ? [emailFactId] : []));
    // Evidence created before emailFactId existed excluded the whole source
    // message. Honour those durable owner choices during the migration window.
    const legacyExcludedEmailIds = new Set(excluded.flatMap(({ emailFactId, emailTransactionId }) => (
      !emailFactId && emailTransactionId ? [emailTransactionId] : []
    )));
    const emailFacts: EmailFact[] = emailFactRows
      .filter((row) => (
        row.emailTransaction.merchant === cluster.canonicalMerchantId
        && !excludedFactIds.has(row.id)
        && !legacyExcludedEmailIds.has(row.emailTransactionId)
      ))
      .flatMap((source) => {
        const fact = toObligationFact(source);
        return fact ? [{ source, fact }] : [];
      });
    const facts: ObligationFact[] = [
      ...cluster.purchases.map((purchase) => ({ type: "CHARGE" as const, occurredAt: purchase.date })),
      ...emailFacts.map(({ fact }) => fact),
    ];
    if (!hasSufficientRecurringEvidence(cluster.purchases.length, facts)) {
      result.skipped += 1;
      continue;
    }
    const confidence = scoreRecurringConfidence(cluster, facts);
    const status = deriveObligationStatus(facts, cluster.cadence.cadence, asOf);
    const projectedDate = nextExpectedDate(cluster, asOf, args.timeZone);
    const lastObservedAt = cluster.purchases.at(-1)?.date
      ?? emailFacts.at(-1)?.fact.occurredAt
      ?? asOf;
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
        emailFactId: null,
        role: "OCCURRENCE" as const,
        excludedByUser: false,
        occurredAt: purchase.date,
      })),
      ...emailFacts.map(({ source, fact }) => {
        const role = evidenceRole(fact);
        return {
          purchaseId: null,
          emailTransactionId: source.emailTransactionId,
          emailFactId: source.id,
          role,
          excludedByUser: false,
          occurredAt: fact.occurredAt,
        };
      }),
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
            origin: resolution.origin,
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
