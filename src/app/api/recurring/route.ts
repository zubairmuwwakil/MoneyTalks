import { type NextRequest, NextResponse } from "next/server";

import { scheduleRecurringObligationRenewalSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { createOwnerSubscription } from "@/lib/domain/recurring/ownerFacts";
import { CADENCE_TYPES, canonicalSubscriptionView, type CanonicalCadenceType } from "@/lib/domain/recurring/readModel";
import { getUnresolvedMerchantCurrencies } from "@/lib/domain/recurring/unresolvedMerchantCurrencies";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

type StoredReason = { code?: unknown; detail?: unknown };
const DEFAULT_TIME_ZONE = "America/Toronto";

function readableReasons(value: unknown): Array<{ code: string | null; detail: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const reason = candidate as StoredReason;
    if (typeof reason.detail !== "string" || !reason.detail.trim()) return [];
    return [{ code: typeof reason.code === "string" ? reason.code : null, detail: reason.detail.trim() }];
  });
}

function requiredDate(value: unknown, label: string): Date {
  if (typeof value !== "string") throw new RangeError(`${label} is required`);
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new RangeError(`${label} must be a valid date`);
  return result;
}

export async function GET(req?: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const reviewOnly = req ? new URL(req.url).searchParams.get("view") === "review" : false;

  const [rows, preference] = await Promise.all([
    prisma.recurringObligation.findMany({
      where: {
        userId,
        ...(reviewOnly ? { origin: { in: ["DETECTED", "EMAIL_STATED"] as const }, needsReview: true } : {}),
      },
      include: {
        evidence: { orderBy: { occurredAt: "asc" } },
        ownerFacts: { orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }] },
      },
      orderBy: reviewOnly
        ? [{ confidence: "desc" }, { lastObservedAt: "desc" }]
        : [{ nextExpectedDate: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    prisma.notificationPreference.findUnique({ where: { userId }, select: { timezone: true } }),
  ]);

  const currencySummary = await getUnresolvedMerchantCurrencies(prisma, userId, preference?.timezone || DEFAULT_TIME_ZONE);
  const currencyNeeds = currencySummary.merchants
    .filter((merchant) => merchant.isRecurringCandidate)
    .map((item) => ({
      merchantCanonicalId: item.merchantCanonicalId,
      cadence: item.candidateCadence,
      unresolvedPurchasesCount: item.unresolvedPurchasesCount,
      evidence: item.candidateCadenceSummary
        ? item.candidateCadenceSummary.occurrences.map(({ id, occurredAt }) => ({ id, occurredAt }))
        : [],
    }));

  return NextResponse.json({
    obligations: rows.map(({ confidenceReasons, ...obligation }) => ({
      ...obligation,
      lifecycleStatus: obligation.status,
      reasons: readableReasons(confidenceReasons),
    })),
    currencyNeeds,
    unresolvedCurrenciesSummary: {
      totalUnresolvedPurchases: currencySummary.totalUnresolvedPurchases,
      totalMerchantsCount: currencySummary.totalMerchantsCount,
      recurringCandidateMerchantsCount: currencySummary.recurringCandidateMerchantsCount,
    },
  });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  try {
    const displayName = typeof body.displayName === "string" ? body.displayName : "";
    const amountMinor = typeof body.amountMinor === "number" ? body.amountMinor : Number.NaN;
    const currency = typeof body.currency === "string" ? body.currency : "";
    const cadence = typeof body.cadence === "string" ? body.cadence.toUpperCase() : "";
    if (!(CADENCE_TYPES as readonly string[]).includes(cadence)) throw new RangeError("cadence is unsupported");
    const nextBillingAt = requiredDate(body.nextBillingAt, "nextBillingAt");
    const trialEndAt = body.trialEndAt == null ? null : requiredDate(body.trialEndAt, "trialEndAt");
    const created = await createOwnerSubscription(prisma, {
      userId,
      input: {
        displayName,
        amountMinor,
        currency,
        cadence: cadence as CanonicalCadenceType,
        nextBillingAt,
        trialEndAt,
        merchantCanonicalId: typeof body.merchantCanonicalId === "string" ? body.merchantCanonicalId : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        cancellationUrl: typeof body.cancellationUrl === "string" ? body.cancellationUrl : null,
        cancelInstructions: typeof body.cancelInstructions === "string" ? body.cancelInstructions : null,
      },
    });
    await scheduleRecurringObligationRenewalSoon({
      userId,
      obligationId: created.id,
      name: created.displayName ?? displayName,
      renewalDate: nextBillingAt,
      amountCents: amountMinor,
      currency,
    });
    return NextResponse.json({ obligation: { ...canonicalSubscriptionView(created), lifecycleStatus: created.status } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create obligation" }, { status: 400 });
  }
}
