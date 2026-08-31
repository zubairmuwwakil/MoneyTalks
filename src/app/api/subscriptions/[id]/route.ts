import { type NextRequest, NextResponse } from "next/server";

import { scheduleRecurringObligationRenewalSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { updateOwnerObligation, type OwnerFactInput, type OwnerMetadataInput } from "@/lib/domain/recurring/ownerFacts";
import { legacySubscriptionProjection } from "@/lib/domain/recurring/readModel";
import { recordLegacySubscriptionAdapterRequest } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

function deprecated(response: NextResponse) {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", "</api/recurring>; rel=\"successor-version\"");
  return response;
}

async function findCanonical(userId: string, legacyOrCanonicalId: string) {
  return prisma.recurringObligation.findFirst({
    where: {
      userId,
      kind: "SUBSCRIPTION",
      OR: [
        { id: legacyOrCanonicalId },
        { legacySubscription: { legacySubscriptionId: legacyOrCanonicalId } },
      ],
    },
    include: {
      legacySubscription: { select: { legacySubscriptionId: true } },
      ownerFacts: {
        where: { supersededBy: null, type: "TRIAL_ENDED" },
        select: { type: true, effectiveAt: true, occurredAt: true },
      },
    },
  });
}

function date(value: unknown, label: string): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${label} invalid`);
  return parsed;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  recordLegacySubscriptionAdapterRequest({ request: req, route: "item", method: "GET" });
  const userId = await getSessionUserId();
  if (!userId) return deprecated(new NextResponse("Unauthorized", { status: 401 }));
  const { id } = await params;
  const obligation = await findCanonical(userId, id);
  if (!obligation) return deprecated(new NextResponse("Not found", { status: 404 }));
  return deprecated(NextResponse.json({ subscription: legacySubscriptionProjection(obligation) }));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  recordLegacySubscriptionAdapterRequest({ request: req, route: "item", method: "PATCH" });
  const userId = await getSessionUserId();
  if (!userId) return deprecated(new NextResponse("Unauthorized", { status: 401 }));
  const { id } = await params;
  const existing = await findCanonical(userId, id);
  if (!existing) return deprecated(new NextResponse("Not found", { status: 404 }));
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return deprecated(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));

  try {
    const metadata: OwnerMetadataInput = {
      ...(typeof body.name === "string" ? { displayName: body.name } : {}),
      ...(typeof body.notes === "string" || body.notes === null ? { notes: body.notes } : {}),
      ...(typeof body.cancelUrl === "string" || body.cancelUrl === null ? { cancellationUrl: body.cancelUrl } : {}),
      ...(typeof body.cancelInstructions === "string" || body.cancelInstructions === null ? { cancelInstructions: body.cancelInstructions } : {}),
      ...(typeof body.merchantCanonicalId === "string" || body.merchantCanonicalId === null ? { merchantCanonicalId: body.merchantCanonicalId } : {}),
    };
    const sourceBase = typeof body.clientSourceKey === "string" && body.clientSourceKey.trim()
      ? body.clientSourceKey.trim()
      : `compat:${crypto.randomUUID()}`;
    const occurredAt = new Date();
    const facts: OwnerFactInput[] = [];
    if (typeof body.amountCents === "number") facts.push({
      type: "PRICE_CHANGE", occurredAt, amountMinor: body.amountCents,
      currency: typeof body.currency === "string" ? body.currency : existing.currency ?? "CAD",
      sourceKey: `${sourceBase}:price`,
    });
    if (typeof body.renewalDate === "string") facts.push({
      type: "NEXT_BILLING_DATE", occurredAt, billingAt: date(body.renewalDate, "renewalDate")!, sourceKey: `${sourceBase}:next`,
    });
    if (typeof body.cadence === "string") {
      const oldCadence = body.cadence.toUpperCase();
      const cadence = oldCadence === "YEARLY" ? "ANNUAL" : oldCadence === "CUSTOM" ? "MONTHLY" : oldCadence;
      if (!["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"].includes(cadence)) throw new RangeError("cadence invalid");
      facts.push({ type: "EXPLICIT_CADENCE", occurredAt, cadence: cadence as "MONTHLY", sourceKey: `${sourceBase}:cadence` });
    }
    if (typeof body.trialEndAt === "string") facts.push({
      type: "TRIAL_ENDED", occurredAt, effectiveAt: date(body.trialEndAt, "trialEndAt"), sourceKey: `${sourceBase}:trial-end`,
    });
    if (body.status === "CANCELLED") facts.push({ type: "CANCELLATION", occurredAt, sourceKey: `${sourceBase}:cancel` });
    if (body.status === "ACTIVE") facts.push({ type: "RESUMPTION", occurredAt, sourceKey: `${sourceBase}:resume` });

    const result = await updateOwnerObligation(prisma, { userId, obligationId: existing.id, metadata, facts });
    if (!result) return deprecated(new NextResponse("Not found", { status: 404 }));
    const next = facts.find((fact) => fact.type === "NEXT_BILLING_DATE")?.billingAt;
    if (next) await scheduleRecurringObligationRenewalSoon({
      userId,
      obligationId: existing.id,
      name: typeof body.name === "string" ? body.name : existing.displayName ?? existing.merchantCanonicalId ?? "Subscription",
      renewalDate: next,
      amountCents: typeof body.amountCents === "number" ? body.amountCents : null,
      currency: typeof body.currency === "string" ? body.currency : existing.currency,
    });
    return deprecated(NextResponse.json({
      ok: true,
      subscription: legacySubscriptionProjection({
        ...result.obligation,
        legacySubscription: existing.legacySubscription,
        ownerFacts: [
          ...existing.ownerFacts,
          ...result.facts.filter((fact) => fact.type === "TRIAL_ENDED"),
        ],
      }),
    }));
  } catch (error) {
    return deprecated(NextResponse.json({ error: error instanceof Error ? error.message : "Could not update subscription" }, { status: 400 }));
  }
}
