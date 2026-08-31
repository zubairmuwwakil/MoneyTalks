import { type NextRequest, NextResponse } from "next/server";

import { scheduleRecurringObligationRenewalSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { createOwnerSubscription } from "@/lib/domain/recurring/ownerFacts";
import { legacySubscriptionProjection } from "@/lib/domain/recurring/readModel";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

function deprecated(response: NextResponse) {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", "</api/recurring>; rel=\"successor-version\"");
  return response;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return deprecated(new NextResponse("Unauthorized", { status: 401 }));

  // Production had zero legacy rows at cutover, so the legacy map will remain
  // empty for all real obligations. A map-only read would silently hide the
  // canonical data. This adapter therefore reads every canonical subscription
  // directly, while using a mapped legacy id when one exists for rollback-era callers.
  const rows = await prisma.recurringObligation.findMany({
    where: { userId, kind: "SUBSCRIPTION" },
    include: {
      legacySubscription: { select: { legacySubscriptionId: true } },
      ownerFacts: {
        where: { supersededBy: null, type: "TRIAL_ENDED" },
        select: { type: true, effectiveAt: true, occurredAt: true },
      },
    },
    orderBy: { nextExpectedDate: "asc" },
  });
  return deprecated(NextResponse.json({ subscriptions: rows.map(legacySubscriptionProjection) }));
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return deprecated(new NextResponse("Unauthorized", { status: 401 }));
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return deprecated(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  const name = typeof body.name === "string" ? body.name : "";
  const amountCents = typeof body.amountCents === "number" ? body.amountCents : null;
  const renewalDate = typeof body.renewalDate === "string" ? new Date(body.renewalDate) : null;
  const currency = typeof body.currency === "string" ? body.currency : "CAD";
  const oldCadence = typeof body.cadence === "string" ? body.cadence.toUpperCase() : "MONTHLY";
  if (!name.trim() || amountCents === null || !renewalDate || Number.isNaN(renewalDate.getTime())) {
    return deprecated(NextResponse.json({ error: "name, amountCents, and a valid renewalDate are required" }, { status: 400 }));
  }
  if (!["MONTHLY", "YEARLY", "CUSTOM"].includes(oldCadence)) {
    return deprecated(NextResponse.json({ error: "cadence must be MONTHLY, YEARLY, or CUSTOM" }, { status: 400 }));
  }
  const trialEndAt = typeof body.trialEndAt === "string" ? new Date(body.trialEndAt) : null;
  if (trialEndAt && Number.isNaN(trialEndAt.getTime())) {
    return deprecated(NextResponse.json({ error: "trialEndAt invalid" }, { status: 400 }));
  }
  try {
    const created = await createOwnerSubscription(prisma, {
      userId,
      input: {
        displayName: name,
        amountMinor: amountCents,
        currency,
        nextBillingAt: renewalDate,
        cadence: oldCadence === "YEARLY" ? "ANNUAL" : "MONTHLY",
        merchantCanonicalId: typeof body.merchantCanonicalId === "string" ? body.merchantCanonicalId : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        cancellationUrl: typeof body.cancelUrl === "string" ? body.cancelUrl : null,
        cancelInstructions: typeof body.cancelInstructions === "string" ? body.cancelInstructions : null,
        trialEndAt,
        needsReview: oldCadence === "CUSTOM",
      },
    });
    await scheduleRecurringObligationRenewalSoon({
      userId, obligationId: created.id, name: created.displayName ?? name,
      renewalDate, amountCents, currency,
    });
    return deprecated(NextResponse.json({ subscription: legacySubscriptionProjection({ ...created, legacySubscription: null, ownerFacts: [] }) }));
  } catch (error) {
    return deprecated(NextResponse.json({ error: error instanceof Error ? error.message : "Could not create subscription" }, { status: 400 }));
  }
}
