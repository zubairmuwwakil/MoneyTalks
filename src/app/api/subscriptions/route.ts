import { NextRequest, NextResponse } from "next/server";

import { createOwnerSubscription } from "@/lib/domain/recurring/ownerFacts";
import { scheduleRecurringObligationRenewalSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

function deprecated(response: NextResponse) {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/recurring>; rel="successor-version"');
  return response;
}

function legacyStatus(status: string | null): "ACTIVE" | "CANCELLED" {
  return status === "CANCELLED" ? "CANCELLED" : "ACTIVE";
}

function cadenceFromStored(value: unknown): "MONTHLY" | "YEARLY" | "CUSTOM" {
  const type = typeof value === "object" && value !== null && "type" in value
    ? (value as { type?: unknown }).type
    : null;
  return type === "MONTHLY" ? "MONTHLY" : type === "ANNUAL" ? "YEARLY" : "CUSTOM";
}

function amountFromSchedule(schedule: unknown): number {
  if (!Array.isArray(schedule) || schedule.length === 0) return 0;
  const latest = schedule.at(-1);
  return typeof latest === "object" && latest !== null && typeof (latest as { amountMinor?: unknown }).amountMinor === "number"
    ? (latest as { amountMinor: number }).amountMinor
    : 0;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const rows = await prisma.recurringObligation.findMany({
    where: { userId, kind: "SUBSCRIPTION" },
    include: { legacySubscription: { select: { legacySubscriptionId: true } } },
    orderBy: { nextExpectedDate: "asc" },
  });
  return deprecated(NextResponse.json({
    subscriptions: rows.map((row) => ({
      id: row.legacySubscription?.legacySubscriptionId ?? row.id,
      canonicalId: row.id,
      name: row.displayName ?? row.merchantCanonicalId ?? "Subscription",
      amountCents: amountFromSchedule(row.schedule),
      currency: row.currency ?? "",
      renewalDate: row.nextExpectedDate,
      cadence: cadenceFromStored(row.cadence),
      status: legacyStatus(row.status),
      lifecycleStatus: row.status,
      notes: row.notes,
      cancelUrl: row.cancellationUrl,
      cancelInstructions: row.cancelInstructions,
      merchantCanonicalId: row.merchantCanonicalId,
    })),
  }));
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name : "";
  const amountCents = typeof body.amountCents === "number" ? body.amountCents : null;
  const renewalDate = typeof body.renewalDate === "string" ? new Date(body.renewalDate) : null;
  const currency = typeof body.currency === "string" ? body.currency : "CAD";
  const oldCadence = typeof body.cadence === "string" ? body.cadence.toUpperCase() : "MONTHLY";
  if (!name.trim() || amountCents === null || !renewalDate || Number.isNaN(renewalDate.getTime())) {
    return NextResponse.json({ error: "name, amountCents, and a valid renewalDate are required" }, { status: 400 });
  }
  if (!["MONTHLY", "YEARLY", "CUSTOM"].includes(oldCadence)) {
    return NextResponse.json({ error: "cadence must be MONTHLY, YEARLY, or CUSTOM" }, { status: 400 });
  }
  const trialEndAt = typeof body.trialEndAt === "string" ? new Date(body.trialEndAt) : null;
  if (trialEndAt && Number.isNaN(trialEndAt.getTime())) return NextResponse.json({ error: "trialEndAt invalid" }, { status: 400 });
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
      userId,
      obligationId: created.id,
      name: created.displayName ?? name,
      renewalDate,
      amountCents,
      currency,
    });
    return deprecated(NextResponse.json({ subscription: { id: created.id, canonicalId: created.id, lifecycleStatus: created.status } }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create subscription" }, { status: 400 });
  }
}
