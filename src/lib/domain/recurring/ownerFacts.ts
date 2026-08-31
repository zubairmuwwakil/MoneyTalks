import { randomUUID } from "node:crypto";

import { type Prisma, type PrismaClient, type RecurringObligationOwnerFactType } from "@prisma/client";

import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { deriveObligationStatus } from "./lifecycle";
import type { ObligationFact } from "./types";

const CADENCE_TYPES = new Set<Cadence["type"]>([
  "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL",
]);

export type OwnerFactInput = {
  type: RecurringObligationOwnerFactType;
  occurredAt: Date;
  effectiveAt?: Date | null;
  billingAt?: Date | null;
  amountMinor?: number | null;
  currency?: string | null;
  cadence?: Cadence["type"] | null;
  note?: string | null;
  supersedesId?: string | null;
  /** A caller-supplied opaque retry key; never a merchant or owner identifier. */
  sourceKey?: string;
};

export type OwnerMetadataInput = {
  displayName?: string | null;
  notes?: string | null;
  cancellationUrl?: string | null;
  cancelInstructions?: string | null;
  merchantCanonicalId?: string | null;
};

export type OwnerSubscriptionInput = {
  displayName: string;
  amountMinor: number;
  currency: string;
  nextBillingAt: Date;
  cadence: Cadence["type"];
  merchantCanonicalId?: string | null;
  notes?: string | null;
  cancellationUrl?: string | null;
  cancelInstructions?: string | null;
  trialEndAt?: Date | null;
  needsReview?: boolean;
};

type StoredOwnerFact = Omit<OwnerFactInput, "sourceKey" | "supersedesId"> & {
  sourceKey: string;
  supersedesId: string | null;
};

type OwnerFactForFold = {
  id?: string;
  type: RecurringObligationOwnerFactType;
  occurredAt: Date;
  recordedAt?: Date;
  effectiveAt: Date | null;
  billingAt: Date | null;
  amountMinor: number | null;
  currency?: string | null;
  cadence: string | null;
};

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validCurrency(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function assertFactPayload(input: OwnerFactInput): StoredOwnerFact {
  if (!validDate(input.occurredAt)) throw new RangeError("occurredAt must be a valid date");
  if (input.effectiveAt != null && !validDate(input.effectiveAt)) throw new RangeError("effectiveAt must be a valid date");
  if (input.billingAt != null && !validDate(input.billingAt)) throw new RangeError("billingAt must be a valid date");
  if (input.amountMinor != null && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0)) {
    throw new RangeError("amountMinor must be a non-negative safe integer");
  }
  const currency = input.currency?.trim().toUpperCase() || null;
  const cadence = input.cadence ?? null;
  const note = input.note?.trim() || null;
  if (note && note.length > 1_000) throw new RangeError("note must be 1000 characters or fewer");

  switch (input.type) {
    case "CHARGE":
    case "PRICE_CHANGE":
      if (input.amountMinor == null || !validCurrency(currency)) throw new RangeError(`${input.type} requires amountMinor and currency`);
      break;
    case "EXPLICIT_CADENCE":
      if (!cadence || !CADENCE_TYPES.has(cadence)) throw new RangeError("EXPLICIT_CADENCE requires a supported cadence");
      break;
    case "NEXT_BILLING_DATE":
      if (!validDate(input.billingAt)) throw new RangeError("NEXT_BILLING_DATE requires billingAt");
      break;
    case "TRIAL_STARTED":
    case "TRIAL_ENDED":
    case "ACTIVATION":
    case "CANCELLATION":
    case "RESUMPTION":
      break;
    default: {
      const exhaustive: never = input.type;
      throw new RangeError(`Unsupported owner fact: ${exhaustive}`);
    }
  }

  const sourceKey = input.sourceKey?.trim() || `owner:${randomUUID()}`;
  if (sourceKey.length > 200) throw new RangeError("sourceKey must be 200 characters or fewer");
  return { ...input, currency, cadence, note, sourceKey, supersedesId: input.supersedesId ?? null };
}

function asCadence(value: Prisma.JsonValue): Cadence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RangeError("Obligation cadence is invalid");
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !CADENCE_TYPES.has(type as Cadence["type"])) throw new RangeError("Obligation cadence type is invalid");
  return value as unknown as Cadence;
}

export function cadenceForOwner(type: Cadence["type"], anchor: Date): Cadence {
  const iso = anchor.toISOString().slice(0, 10);
  return type === "MONTHLY" ? { type, dayOfMonth: anchor.getUTCDate(), startsFrom: iso } : { type, anchor: iso };
}

function scheduleEntries(value: Prisma.JsonValue): ScheduleEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
    const entry = candidate as { from?: unknown; to?: unknown; amountMinor?: unknown };
    if (typeof entry.from !== "string" || typeof entry.amountMinor !== "number") return [];
    return [{ from: entry.from, ...(typeof entry.to === "string" ? { to: entry.to } : {}), amountMinor: entry.amountMinor }];
  });
}

function cleanMetadataValue(value: string | null | undefined, key: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "string") throw new RangeError(`${key} must be a string or null`);
  const trimmed = value?.trim() || null;
  if (trimmed && trimmed.length > max) throw new RangeError(`${key} is too long`);
  return trimmed;
}

function normalizeMetadata(input: OwnerMetadataInput): OwnerMetadataInput {
  return {
    ...(Object.hasOwn(input, "displayName") ? { displayName: cleanMetadataValue(input.displayName, "displayName", 500) } : {}),
    ...(Object.hasOwn(input, "notes") ? { notes: cleanMetadataValue(input.notes, "notes", 4_000) } : {}),
    ...(Object.hasOwn(input, "cancellationUrl") ? { cancellationUrl: cleanMetadataValue(input.cancellationUrl, "cancellationUrl", 500) } : {}),
    ...(Object.hasOwn(input, "cancelInstructions") ? { cancelInstructions: cleanMetadataValue(input.cancelInstructions, "cancelInstructions", 4_000) } : {}),
    ...(Object.hasOwn(input, "merchantCanonicalId") ? { merchantCanonicalId: cleanMetadataValue(input.merchantCanonicalId, "merchantCanonicalId", 500) } : {}),
  };
}

/** Translate stored owner evidence into the domain lifecycle-fact union. */
export function ownerFactToObligationFact(fact: OwnerFactForFold): ObligationFact {
  switch (fact.type) {
    case "CHARGE": return { type: "CHARGE", occurredAt: fact.occurredAt, source: "OWNER" };
    case "EXPLICIT_CADENCE":
      if (!fact.cadence || !CADENCE_TYPES.has(fact.cadence as Cadence["type"])) throw new RangeError("Invalid owner cadence");
      return { type: fact.type, occurredAt: fact.occurredAt, cadence: fact.cadence as Cadence["type"], source: "OWNER" };
    case "NEXT_BILLING_DATE":
      if (!fact.billingAt) throw new RangeError("Invalid owner next billing date");
      return { type: fact.type, occurredAt: fact.occurredAt, billingAt: fact.billingAt, source: "OWNER" };
    case "PRICE_CHANGE": return { type: fact.type, occurredAt: fact.occurredAt, effectiveAt: fact.effectiveAt ?? undefined, amountMinor: fact.amountMinor ?? undefined, source: "OWNER" };
    case "TRIAL_STARTED":
    case "TRIAL_ENDED":
    case "CANCELLATION": return { type: fact.type, occurredAt: fact.occurredAt, effectiveAt: fact.effectiveAt ?? undefined, source: "OWNER" };
    case "ACTIVATION":
    case "RESUMPTION": return { type: fact.type, occurredAt: fact.occurredAt, source: "OWNER" };
    default: {
      const exhaustive: never = fact.type;
      throw new RangeError(`Unsupported owner fact: ${exhaustive}`);
    }
  }
}

function emailFactToObligationFact(fact: {
  type: string; occurredAt: Date; effectiveAt: Date | null; billingAt: Date | null;
  amountMinor: number | null; cadence: string | null;
}): ObligationFact | null {
  switch (fact.type) {
    case "EXPLICIT_CADENCE": return fact.cadence && CADENCE_TYPES.has(fact.cadence as Cadence["type"])
      ? { type: fact.type, occurredAt: fact.occurredAt, cadence: fact.cadence as Cadence["type"], source: "EMAIL" } : null;
    case "EXPLICIT_RECURRING": return { type: fact.type, occurredAt: fact.occurredAt, source: "EMAIL" };
    case "CANCELLATION":
    case "TRIAL_STARTED":
    case "TRIAL_ENDED": return { type: fact.type, occurredAt: fact.occurredAt, effectiveAt: fact.effectiveAt ?? undefined, source: "EMAIL" };
    case "PRICE_CHANGE": return { type: fact.type, occurredAt: fact.occurredAt, effectiveAt: fact.effectiveAt ?? undefined, amountMinor: fact.amountMinor ?? undefined, source: "EMAIL" };
    case "NEXT_BILLING_DATE": return fact.billingAt ? { type: fact.type, occurredAt: fact.occurredAt, billingAt: fact.billingAt, source: "EMAIL" } : null;
    default: return null;
  }
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

function sameStoredFact(existing: OwnerFactForFold & {
  currency: string | null; note: string | null; supersedesId: string | null;
}, input: StoredOwnerFact): boolean {
  return existing.type === input.type
    && sameDate(existing.occurredAt, input.occurredAt)
    && sameDate(existing.effectiveAt, input.effectiveAt)
    && sameDate(existing.billingAt, input.billingAt)
    && existing.amountMinor === (input.amountMinor ?? null)
    && existing.currency === input.currency
    && existing.cadence === input.cadence
    && existing.note === (input.note ?? null)
    && existing.supersedesId === input.supersedesId;
}

/** Recompute the sweep-owned projection from purchase, email, and owner facts. */
export async function rederiveOwnerProjectionInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  obligationId: string,
  asOf = new Date(),
) {
  const obligation = await tx.recurringObligation.findFirst({
    where: { id: obligationId, userId },
    select: {
      id: true, cadence: true, schedule: true, nextExpectedDate: true, lastObservedAt: true,
      ownerFacts: {
        where: { supersededBy: null },
        orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
        select: { id: true, type: true, occurredAt: true, recordedAt: true, effectiveAt: true, billingAt: true, amountMinor: true, currency: true, cadence: true },
      },
      evidence: {
        where: { excludedByUser: false },
        select: {
          purchaseId: true,
          occurredAt: true,
          emailFact: { select: { type: true, occurredAt: true, effectiveAt: true, billingAt: true, amountMinor: true, cadence: true } },
        },
      },
    },
  });
  if (!obligation) return null;

  const ownerFacts = obligation.ownerFacts;
  const evidenceFacts = obligation.evidence.flatMap((evidence): ObligationFact[] => {
    if (evidence.purchaseId) return [{ type: "CHARGE", occurredAt: evidence.occurredAt, source: "PURCHASE" }];
    if (!evidence.emailFact) return [];
    const fact = emailFactToObligationFact(evidence.emailFact);
    return fact ? [fact] : [];
  });
  const lifecycleFacts = [...evidenceFacts, ...ownerFacts.map(ownerFactToObligationFact)];
  const latestBilling = ownerFacts.findLast((fact) => fact.type === "NEXT_BILLING_DATE" && fact.billingAt);
  const latestCadence = ownerFacts.findLast((fact) => fact.type === "EXPLICIT_CADENCE" && fact.cadence);
  const latestPrice = ownerFacts.findLast((fact) => fact.type === "PRICE_CHANGE" && fact.amountMinor !== null && fact.currency);
  const nextExpectedDate = latestBilling?.billingAt ?? obligation.nextExpectedDate;
  const cadence = latestCadence?.cadence
    ? cadenceForOwner(latestCadence.cadence as Cadence["type"], nextExpectedDate ?? latestCadence.occurredAt)
    : asCadence(obligation.cadence);
  let schedule = scheduleEntries(obligation.schedule);
  if (latestPrice?.amountMinor != null) {
    const from = (latestPrice.effectiveAt ?? latestPrice.occurredAt).toISOString().slice(0, 10);
    schedule = [...schedule.filter((entry) => entry.from < from), { from, amountMinor: latestPrice.amountMinor }];
  }
  const lastObservedAt = lifecycleFacts.reduce(
    (latest, fact) => fact.occurredAt > latest ? fact.occurredAt : latest,
    obligation.lastObservedAt,
  );
  const status = deriveObligationStatus(lifecycleFacts, cadence, asOf);
  return tx.recurringObligation.update({
    where: { id: obligation.id },
    data: {
      cadence: cadence as unknown as Prisma.InputJsonValue,
      schedule: schedule as unknown as Prisma.InputJsonValue,
      status,
      nextExpectedDate,
      lastObservedAt,
      ...(latestPrice?.currency ? { currency: latestPrice.currency } : {}),
    },
  });
}

/** Create a canonical subscription and its initial owner assertions atomically. */
export async function createOwnerSubscription(db: PrismaClient, args: { userId: string; input: OwnerSubscriptionInput }) {
  const name = args.input.displayName.trim();
  const currency = args.input.currency.trim().toUpperCase();
  if (!name) throw new RangeError("displayName is required");
  if (!Number.isSafeInteger(args.input.amountMinor) || args.input.amountMinor < 0) throw new RangeError("amountMinor must be a non-negative safe integer");
  if (!validCurrency(currency)) throw new RangeError("currency must be a three-letter code");
  if (!validDate(args.input.nextBillingAt)) throw new RangeError("nextBillingAt must be a valid date");
  if (!CADENCE_TYPES.has(args.input.cadence)) throw new RangeError("cadence is unsupported");
  if (args.input.trialEndAt && !validDate(args.input.trialEndAt)) throw new RangeError("trialEndAt must be a valid date");

  const occurredAt = new Date();
  const cadence = cadenceForOwner(args.input.cadence, args.input.nextBillingAt);
  const sourcePrefix = `owner:create:${randomUUID()}`;
  return db.$transaction(async (tx) => {
    const obligation = await tx.recurringObligation.create({
      data: {
        userId: args.userId, kind: "SUBSCRIPTION", displayName: name,
        merchantCanonicalId: args.input.merchantCanonicalId?.trim() || null,
        notes: args.input.notes?.trim() || null,
        cancellationUrl: args.input.cancellationUrl?.trim() || null,
        cancelInstructions: args.input.cancelInstructions?.trim() || null,
        currency, discriminator: "", seriesKey: `owner:${randomUUID()}`,
        cadence: cadence as unknown as Prisma.InputJsonValue,
        schedule: [{ amountMinor: args.input.amountMinor, from: args.input.nextBillingAt.toISOString().slice(0, 10) }] as unknown as Prisma.InputJsonValue,
        amountPattern: "FIXED", status: null, nextExpectedDate: args.input.nextBillingAt,
        confidence: 1, confidenceReasons: [] as Prisma.InputJsonValue, lastObservedAt: occurredAt,
        algorithmVersion: 1, origin: "USER", needsReview: args.input.needsReview ?? false,
      },
    });
    const facts = [
      { type: "ACTIVATION" as const, sourceKey: `${sourcePrefix}:activation`, occurredAt },
      { type: "PRICE_CHANGE" as const, sourceKey: `${sourcePrefix}:price`, occurredAt, amountMinor: args.input.amountMinor, currency },
      { type: "EXPLICIT_CADENCE" as const, sourceKey: `${sourcePrefix}:cadence`, occurredAt, cadence: args.input.cadence },
      { type: "NEXT_BILLING_DATE" as const, sourceKey: `${sourcePrefix}:next`, occurredAt, billingAt: args.input.nextBillingAt },
      ...(args.input.trialEndAt ? [{ type: "TRIAL_ENDED" as const, sourceKey: `${sourcePrefix}:trial-end`, occurredAt, effectiveAt: args.input.trialEndAt }] : []),
    ];
    await tx.recurringObligationOwnerFact.createMany({
      data: facts.map((fact) => ({
        userId: args.userId, obligationId: obligation.id, type: fact.type, source: "OWNER_ACTION" as const,
        sourceKey: fact.sourceKey, occurredAt: fact.occurredAt,
        effectiveAt: "effectiveAt" in fact ? fact.effectiveAt ?? null : null,
        billingAt: "billingAt" in fact ? fact.billingAt ?? null : null,
        amountMinor: "amountMinor" in fact ? fact.amountMinor ?? null : null,
        currency: "currency" in fact ? fact.currency ?? null : null,
        cadence: "cadence" in fact ? fact.cadence ?? null : null,
      })),
    });
    return (await rederiveOwnerProjectionInTransaction(tx, args.userId, obligation.id, occurredAt))!;
  });
}

/** Append typed owner assertions and metadata changes in one canonical transaction. */
export async function updateOwnerObligation(
  db: PrismaClient,
  args: { userId: string; obligationId: string; metadata?: OwnerMetadataInput; facts?: OwnerFactInput[] },
) {
  const metadata = normalizeMetadata(args.metadata ?? {});
  const inputs = (args.facts ?? []).map(assertFactPayload);
  return db.$transaction(async (tx) => {
    const obligation = await tx.recurringObligation.findFirst({ where: { id: args.obligationId, userId: args.userId }, select: { id: true } });
    if (!obligation) return null;

    const supersedesIds = inputs.flatMap((input) => input.supersedesId ? [input.supersedesId] : []);
    if (supersedesIds.length > 0) {
      const superseded = await tx.recurringObligationOwnerFact.findMany({
        where: { id: { in: supersedesIds }, obligationId: args.obligationId, userId: args.userId },
        select: { id: true, type: true },
      });
      const byId = new Map(superseded.map((fact) => [fact.id, fact.type]));
      for (const input of inputs) {
        if (input.supersedesId && byId.get(input.supersedesId) !== input.type) {
          throw new RangeError("supersedesId must reference the same fact type on this obligation");
        }
      }
    }

    if (Object.keys(metadata).length > 0) await tx.recurringObligation.update({ where: { id: obligation.id }, data: metadata });
    const stored = [];
    for (const input of inputs) {
      const fact = await tx.recurringObligationOwnerFact.upsert({
        where: { obligationId_sourceKey: { obligationId: obligation.id, sourceKey: input.sourceKey } },
        create: {
          userId: args.userId, obligationId: obligation.id, type: input.type, source: "OWNER_ACTION",
          sourceKey: input.sourceKey, occurredAt: input.occurredAt, effectiveAt: input.effectiveAt ?? null,
          billingAt: input.billingAt ?? null, amountMinor: input.amountMinor ?? null, currency: input.currency,
          cadence: input.cadence, note: input.note ?? null, supersedesId: input.supersedesId,
        },
        update: {},
      });
      if (!sameStoredFact(fact, input)) throw new RangeError("sourceKey already identifies a different owner fact");
      stored.push(fact);
    }
    const updated = await rederiveOwnerProjectionInTransaction(tx, args.userId, obligation.id);
    return { obligation: updated!, facts: stored };
  });
}

/** Append one owner assertion. Replaying an identical source key is a no-op. */
export async function appendOwnerFact(db: PrismaClient, args: { userId: string; obligationId: string; input: OwnerFactInput }) {
  const result = await updateOwnerObligation(db, { userId: args.userId, obligationId: args.obligationId, facts: [args.input] });
  return result?.facts[0] ?? null;
}

export async function rederiveOwnerLifecycle(db: PrismaClient, userId: string, obligationId: string) {
  const updated = await db.$transaction((tx) => rederiveOwnerProjectionInTransaction(tx, userId, obligationId));
  return updated?.status ?? null;
}

export const ownerFactValidation = { assertFactPayload };
