import { NextRequest, NextResponse } from "next/server";

import { appendOwnerFact } from "@/lib/domain/recurring/ownerFacts";
import { scheduleRecurringObligationRenewalSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

function deprecated(response: NextResponse) {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/recurring>; rel="successor-version"');
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
  });
}

function date(value: unknown, label: string): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`${label} invalid`);
  return parsed;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const obligation = await findCanonical(userId, id);
  if (!obligation) return new NextResponse("Not found", { status: 404 });
  return deprecated(NextResponse.json({ subscription: { ...obligation, canonicalId: obligation.id, lifecycleStatus: obligation.status } }));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const existing = await findCanonical(userId, id);
  if (!existing) return new NextResponse("Not found", { status: 404 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  try {
    const metadata = {
      ...(typeof body.name === "string" ? { displayName: body.name.trim() || null } : {}),
      ...(typeof body.notes === "string" || body.notes === null ? { notes: body.notes } : {}),
      ...(typeof body.cancelUrl === "string" || body.cancelUrl === null ? { cancellationUrl: body.cancelUrl } : {}),
      ...(typeof body.cancelInstructions === "string" || body.cancelInstructions === null ? { cancelInstructions: body.cancelInstructions } : {}),
      ...(typeof body.merchantCanonicalId === "string" || body.merchantCanonicalId === null ? { merchantCanonicalId: body.merchantCanonicalId } : {}),
    };
    if (Object.keys(metadata).length > 0) await prisma.recurringObligation.update({ where: { id: existing.id }, data: metadata });

    const sourceBase = typeof body.clientSourceKey === "string" && body.clientSourceKey.trim()
      ? body.clientSourceKey.trim()
      : `compat:${crypto.randomUUID()}`;
    const occurredAt = new Date();
    const facts = [] as Array<Parameters<typeof appendOwnerFact>[1]["input"]>;
    if (typeof body.amountCents === "number") facts.push({ type: "PRICE_CHANGE", occurredAt, amountMinor: body.amountCents, currency: typeof body.currency === "string" ? body.currency : existing.currency ?? "CAD", sourceKey: `${sourceBase}:price` });
    if (typeof body.renewalDate === "string") facts.push({ type: "NEXT_BILLING_DATE", occurredAt, billingAt: date(body.renewalDate, "renewalDate")!, sourceKey: `${sourceBase}:next` });
    if (typeof body.cadence === "string") {
      const cadence = body.cadence.toUpperCase() === "YEARLY" ? "ANNUAL" : body.cadence.toUpperCase() === "CUSTOM" ? "MONTHLY" : body.cadence.toUpperCase();
      if (!["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"].includes(cadence)) throw new RangeError("cadence invalid");
      facts.push({ type: "EXPLICIT_CADENCE", occurredAt, cadence: cadence as "MONTHLY", sourceKey: `${sourceBase}:cadence` });
    }
    if (typeof body.trialEndAt === "string") facts.push({ type: "TRIAL_ENDED", occurredAt, effectiveAt: date(body.trialEndAt, "trialEndAt"), sourceKey: `${sourceBase}:trial-end` });
    if (body.status === "CANCELLED") facts.push({ type: "CANCELLATION", occurredAt, sourceKey: `${sourceBase}:cancel` });
    if (body.status === "ACTIVE") facts.push({ type: "RESUMPTION", occurredAt, sourceKey: `${sourceBase}:resume` });
    for (const fact of facts) await appendOwnerFact(prisma, { userId, obligationId: existing.id, input: fact });

    const next = facts.find((fact) => fact.type === "NEXT_BILLING_DATE")?.billingAt;
    if (next) await scheduleRecurringObligationRenewalSoon({
      userId,
      obligationId: existing.id,
      name: typeof body.name === "string" ? body.name : existing.displayName ?? existing.merchantCanonicalId ?? "Subscription",
      renewalDate: next,
      amountCents: typeof body.amountCents === "number" ? body.amountCents : null,
      currency: typeof body.currency === "string" ? body.currency : existing.currency,
    });
    return deprecated(NextResponse.json({ ok: true, canonicalId: existing.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update subscription" }, { status: 400 });
  }
}
