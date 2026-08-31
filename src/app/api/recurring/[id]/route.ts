import { Prisma, type RecurringObligationOwnerFactType } from "@prisma/client";
import { type NextRequest, NextResponse } from "next/server";

import { confirmMerchantCurrency } from "@/lib/domain/recurring/confirmMerchantCurrency";
import { sweepRecurringObligations } from "@/lib/domain/recurring/detectRecurring";
import {
  rederiveOwnerProjectionInTransaction,
  updateOwnerObligation,
  type OwnerFactInput,
  type OwnerMetadataInput,
} from "@/lib/domain/recurring/ownerFacts";
import { CADENCE_TYPES, type CanonicalCadenceType } from "@/lib/domain/recurring/readModel";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

type RecurringAction = "confirm" | "dismiss" | "exclude-evidence" | "reassign-evidence" | "set-currency" | "update" | "append-fact";
type ActionBody = {
  action?: RecurringAction;
  dismissReason?: unknown;
  evidenceId?: unknown;
  targetObligationId?: unknown;
  currency?: unknown;
  metadata?: unknown;
  facts?: unknown;
  fact?: unknown;
};

const OWNER_FACT_TYPES = new Set<RecurringObligationOwnerFactType>([
  "CHARGE", "EXPLICIT_CADENCE", "NEXT_BILLING_DATE", "PRICE_CHANGE", "TRIAL_STARTED",
  "TRIAL_ENDED", "ACTIVATION", "CANCELLATION", "RESUMPTION",
]);
const DEFAULT_TIME_ZONE = "America/Toronto";

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function currencyCode(value: unknown): string | null {
  const normalized = nonEmptyString(value)?.toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function optionalDate(value: unknown, label: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new RangeError(`${label} must be an ISO date`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError(`${label} must be a valid date`);
  return date;
}

function parseFact(value: unknown): OwnerFactInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RangeError("fact must be an object");
  const fact = value as Record<string, unknown>;
  if (typeof fact.type !== "string" || !OWNER_FACT_TYPES.has(fact.type as RecurringObligationOwnerFactType)) {
    throw new RangeError("fact type is unsupported");
  }
  const occurredAt = optionalDate(fact.occurredAt, "occurredAt");
  if (!(occurredAt instanceof Date)) throw new RangeError("occurredAt is required");
  const cadence = typeof fact.cadence === "string" ? fact.cadence.toUpperCase() : null;
  if (cadence && !(CADENCE_TYPES as readonly string[]).includes(cadence)) throw new RangeError("cadence is unsupported");
  return {
    type: fact.type as RecurringObligationOwnerFactType,
    occurredAt,
    effectiveAt: optionalDate(fact.effectiveAt, "effectiveAt"),
    billingAt: optionalDate(fact.billingAt, "billingAt"),
    amountMinor: typeof fact.amountMinor === "number" ? fact.amountMinor : null,
    currency: typeof fact.currency === "string" ? fact.currency : null,
    cadence: cadence as CanonicalCadenceType | null,
    note: typeof fact.note === "string" ? fact.note : null,
    supersedesId: typeof fact.supersedesId === "string" ? fact.supersedesId : null,
    sourceKey: typeof fact.sourceKey === "string" ? fact.sourceKey : undefined,
  };
}

function parseMetadata(value: unknown): OwnerMetadataInput {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RangeError("metadata must be an object");
  const input = value as Record<string, unknown>;
  const metadata: OwnerMetadataInput = {};
  for (const key of ["displayName", "notes", "cancellationUrl", "cancelInstructions", "merchantCanonicalId"] as const) {
    if (!(key in input)) continue;
    if (input[key] !== null && typeof input[key] !== "string") throw new RangeError(`${key} must be a string or null`);
    metadata[key] = input[key] as string | null;
  }
  return metadata;
}

async function findCanonical(userId: string, id: string) {
  return prisma.recurringObligation.findFirst({
    where: { id, userId },
    include: {
      evidence: { orderBy: { occurredAt: "asc" } },
      ownerFacts: { orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }] },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const obligation = await findCanonical(userId, id);
  if (!obligation) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ obligation: { ...obligation, lifecycleStatus: obligation.status } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null) as ActionBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  if (!body.action || !["confirm", "dismiss", "exclude-evidence", "reassign-evidence", "set-currency", "update", "append-fact"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const { id } = await params;

  try {
    if (body.action === "update" || body.action === "append-fact") {
      const rawFacts = body.action === "append-fact" ? [body.fact] : body.facts ?? [];
      if (!Array.isArray(rawFacts) || rawFacts.length > 20) throw new RangeError("facts must be an array of at most 20 items");
      const result = await updateOwnerObligation(prisma, {
        userId,
        obligationId: id,
        metadata: body.action === "update" ? parseMetadata(body.metadata) : {},
        facts: rawFacts.map(parseFact),
      });
      if (!result) return new NextResponse("Not found", { status: 404 });
      return NextResponse.json({ ok: true, obligation: { ...result.obligation, lifecycleStatus: result.obligation.status }, facts: result.facts });
    }

    if (body.action === "set-currency") {
      const currency = currencyCode(body.currency);
      if (!currency) return NextResponse.json({ error: "Currency must be a three-letter code" }, { status: 400 });
      const obligation = await prisma.recurringObligation.findFirst({
        where: { id, userId, origin: { in: ["DETECTED", "EMAIL_STATED"] }, needsReview: true },
        select: { merchantCanonicalId: true },
      });
      if (!obligation) return new NextResponse("Not found", { status: 404 });
      if (!obligation.merchantCanonicalId) return NextResponse.json({ error: "A merchant identity is required before setting currency." }, { status: 400 });
      const { affectedPurchases } = await confirmMerchantCurrency(prisma, {
        userId, merchantCanonicalId: obligation.merchantCanonicalId, currency,
      }, { replaceLearnedPurchases: true });
      const preference = await prisma.notificationPreference.findUnique({ where: { userId }, select: { timezone: true } });
      await sweepRecurringObligations(prisma, { userId, timeZone: preference?.timezone || DEFAULT_TIME_ZONE, algorithmVersion: 1 });
      return NextResponse.json({ ok: true, affectedPurchases });
    }

    if (body.action === "exclude-evidence") {
      const evidenceId = nonEmptyString(body.evidenceId);
      if (!evidenceId) return NextResponse.json({ error: "evidenceId is required" }, { status: 400 });
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.recurringObligationEvidence.updateMany({
          where: { id: evidenceId, obligationId: id, obligation: { userId } },
          data: { excludedByUser: true },
        });
        if (result.count > 0) await rederiveOwnerProjectionInTransaction(tx, userId, id);
        return result;
      });
      if (updated.count === 0) return new NextResponse("Evidence not found", { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reassign-evidence") {
      const evidenceId = nonEmptyString(body.evidenceId);
      const targetObligationId = nonEmptyString(body.targetObligationId);
      if (!evidenceId || !targetObligationId) return NextResponse.json({ error: "evidenceId and targetObligationId are required" }, { status: 400 });
      const moved = await prisma.$transaction(async (tx) => {
        const target = await tx.recurringObligation.findFirst({ where: { id: targetObligationId, userId }, select: { id: true } });
        if (!target) return false;
        const result = await tx.recurringObligationEvidence.updateMany({
          where: { id: evidenceId, obligationId: id, obligation: { userId } },
          data: { obligationId: target.id },
        });
        if (result.count === 0) return false;
        await rederiveOwnerProjectionInTransaction(tx, userId, id);
        await rederiveOwnerProjectionInTransaction(tx, userId, target.id);
        return true;
      });
      if (!moved) return new NextResponse("Evidence or target obligation not found", { status: 404 });
      return NextResponse.json({ ok: true, targetObligationId });
    }

    const dismissReason = body.action === "dismiss" ? nonEmptyString(body.dismissReason) : null;
    if (body.action === "dismiss" && !dismissReason) return NextResponse.json({ error: "A dismissal reason is required" }, { status: 400 });
    if (dismissReason && dismissReason.length > 200) return NextResponse.json({ error: "Dismissal reason must be 200 characters or fewer" }, { status: 400 });
    const decision = body.action === "confirm"
      ? Prisma.sql`
          UPDATE "RecurringObligation"
          SET "needsReview" = false, "confirmedAt" = CURRENT_TIMESTAMP, "dismissedAt" = NULL,
              "dismissReason" = NULL, "decidedConfidence" = confidence,
              "decidedReasons" = "confidenceReasons", "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${id} AND "userId" = ${userId} AND "needsReview" = true
            AND "confirmedAt" IS NULL AND "dismissedAt" IS NULL RETURNING id
        `
      : Prisma.sql`
          UPDATE "RecurringObligation"
          SET "needsReview" = false, "confirmedAt" = NULL, "dismissedAt" = CURRENT_TIMESTAMP,
              "dismissReason" = ${dismissReason}, "decidedConfidence" = confidence,
              "decidedReasons" = "confidenceReasons", "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${id} AND "userId" = ${userId} AND "needsReview" = true
            AND "confirmedAt" IS NULL AND "dismissedAt" IS NULL RETURNING id
        `;
    const updated = await prisma.$queryRaw<Array<{ id: string }>>(decision);
    if (updated.length === 0) {
      const existing = await prisma.recurringObligation.findFirst({ where: { id, userId }, select: { id: true } });
      if (!existing) return new NextResponse("Not found", { status: 404 });
      return NextResponse.json({ ok: true, alreadyHandled: true });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update obligation" }, { status: 400 });
  }
}
