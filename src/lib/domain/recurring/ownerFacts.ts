import { randomUUID } from "node:crypto";

import {
  type Prisma,
  type PrismaClient,
  type RecurringObligationOwnerFactType,
} from "@prisma/client";

import type { Cadence } from "@/engine/recurrence";
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

type StoredOwnerFact = Omit<OwnerFactInput, "sourceKey" | "supersedesId"> & {
  sourceKey: string;
  supersedesId: string | null;
};

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validCurrency(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function assertFactPayload(input: OwnerFactInput): StoredOwnerFact {
  if (!validDate(input.occurredAt)) throw new RangeError("occurredAt must be a valid date");
  if (input.effectiveAt !== undefined && input.effectiveAt !== null && !validDate(input.effectiveAt)) {
    throw new RangeError("effectiveAt must be a valid date");
  }
  if (input.billingAt !== undefined && input.billingAt !== null && !validDate(input.billingAt)) {
    throw new RangeError("billingAt must be a valid date");
  }
  if (input.amountMinor !== undefined && input.amountMinor !== null && !Number.isSafeInteger(input.amountMinor)) {
    throw new RangeError("amountMinor must be a safe integer");
  }
  const currency = input.currency?.trim().toUpperCase() || null;
  const cadence = input.cadence ?? null;
  const hasAmount = input.amountMinor !== undefined && input.amountMinor !== null;

  switch (input.type) {
    case "CHARGE":
    case "PRICE_CHANGE":
      if (!hasAmount || !validCurrency(currency)) throw new RangeError(`${input.type} requires amountMinor and currency`);
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

  return {
    ...input,
    currency,
    cadence,
    sourceKey: input.sourceKey?.trim() || `owner:${randomUUID()}`,
    supersedesId: input.supersedesId ?? null,
  };
}

function asCadence(value: Prisma.JsonValue): Cadence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError("Obligation cadence is invalid");
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !CADENCE_TYPES.has(type as Cadence["type"])) {
    throw new RangeError("Obligation cadence type is invalid");
  }
  return value as unknown as Cadence;
}

/** Translate stored owner evidence into the domain's lifecycle-fact union. */
export function ownerFactToObligationFact(fact: {
  type: RecurringObligationOwnerFactType;
  occurredAt: Date;
  effectiveAt: Date | null;
  billingAt: Date | null;
  amountMinor: number | null;
  cadence: string | null;
}): ObligationFact {
  switch (fact.type) {
    case "CHARGE":
      return { type: "CHARGE", occurredAt: fact.occurredAt, source: "OWNER" };
    case "EXPLICIT_CADENCE":
      if (!fact.cadence || !CADENCE_TYPES.has(fact.cadence as Cadence["type"])) throw new RangeError("Invalid owner cadence");
      return { type: "EXPLICIT_CADENCE", occurredAt: fact.occurredAt, cadence: fact.cadence as Cadence["type"], source: "OWNER" };
    case "NEXT_BILLING_DATE":
      if (!fact.billingAt) throw new RangeError("Invalid owner next billing date");
      return { type: "NEXT_BILLING_DATE", occurredAt: fact.occurredAt, billingAt: fact.billingAt, source: "OWNER" };
    case "PRICE_CHANGE":
      return { type: "PRICE_CHANGE", occurredAt: fact.occurredAt, effectiveAt: fact.effectiveAt ?? undefined, amountMinor: fact.amountMinor ?? undefined, source: "OWNER" };
    case "TRIAL_STARTED":
    case "TRIAL_ENDED":
    case "CANCELLATION":
      return { type: fact.type, occurredAt: fact.occurredAt, effectiveAt: fact.effectiveAt ?? undefined, source: "OWNER" };
    case "ACTIVATION":
    case "RESUMPTION":
      return { type: fact.type, occurredAt: fact.occurredAt, source: "OWNER" };
    default: {
      const exhaustive: never = fact.type;
      throw new RangeError(`Unsupported owner fact: ${exhaustive}`);
    }
  }
}

/**
 * Append one owner assertion. Replaying the same opaque source key is a no-op;
 * no compatibility path ever writes Subscription or SubscriptionPayment.
 */
export async function appendOwnerFact(
  db: PrismaClient,
  args: { userId: string; obligationId: string; input: OwnerFactInput },
) {
  const input = assertFactPayload(args.input);
  const obligation = await db.recurringObligation.findFirst({
    where: { id: args.obligationId, userId: args.userId },
    select: { id: true },
  });
  if (!obligation) return null;

  if (input.supersedesId) {
    const superseded = await db.recurringObligationOwnerFact.findFirst({
      where: { id: input.supersedesId, obligationId: args.obligationId, userId: args.userId },
      select: { id: true },
    });
    if (!superseded) throw new RangeError("supersedesId must reference this obligation's owner fact");
  }

  const fact = await db.recurringObligationOwnerFact.upsert({
    where: { obligationId_sourceKey: { obligationId: args.obligationId, sourceKey: input.sourceKey } },
    create: {
      userId: args.userId,
      obligationId: args.obligationId,
      type: input.type,
      source: "OWNER_ACTION",
      sourceKey: input.sourceKey,
      occurredAt: input.occurredAt,
      effectiveAt: input.effectiveAt ?? null,
      billingAt: input.billingAt ?? null,
      amountMinor: input.amountMinor ?? null,
      currency: input.currency,
      cadence: input.cadence,
      note: input.note ?? null,
      supersedesId: input.supersedesId,
    },
    update: {},
  });
  await rederiveOwnerLifecycle(db, args.userId, args.obligationId);
  return fact;
}

/** Recompute only the sweep-owned lifecycle cache from append-only owner facts. */
export async function rederiveOwnerLifecycle(db: PrismaClient, userId: string, obligationId: string) {
  const obligation = await db.recurringObligation.findFirst({
    where: { id: obligationId, userId },
    select: { cadence: true },
  });
  if (!obligation) return null;
  const facts = await db.recurringObligationOwnerFact.findMany({
    where: { obligationId, userId, supersededBy: null },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    select: {
      type: true,
      occurredAt: true,
      effectiveAt: true,
      billingAt: true,
      amountMinor: true,
      cadence: true,
    },
  });
  const status = deriveObligationStatus(facts.map(ownerFactToObligationFact), asCadence(obligation.cadence), new Date());
  await db.recurringObligation.update({ where: { id: obligationId }, data: { status } });
  return status;
}

export const ownerFactValidation = { assertFactPayload };
