import { NextResponse } from "next/server";

import { clusterRecurringPurchases } from "@/lib/domain/recurring/clustering";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

type StoredReason = { code?: unknown; detail?: unknown };
const UNRESOLVED_CURRENCY_SENTINEL = "__currency_needed_for_review__";
const DEFAULT_TIME_ZONE = "America/Toronto";

function readableReasons(value: unknown): Array<{ code: string | null; detail: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const reason = candidate as StoredReason;
    if (typeof reason.detail !== "string" || !reason.detail.trim()) return [];
    return [{
      code: typeof reason.code === "string" ? reason.code : null,
      detail: reason.detail.trim(),
    }];
  });
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const [rows, unresolvedPurchases, preference] = await Promise.all([
    prisma.recurringObligation.findMany({
      where: { userId, origin: "DETECTED", needsReview: true },
      include: {
        evidence: { orderBy: { occurredAt: "asc" } },
      },
      orderBy: [{ confidence: "desc" }, { lastObservedAt: "desc" }],
      take: 200,
    }),
    prisma.purchase.findMany({
      where: { userId, currency: null, totalCents: { not: null } },
      select: { id: true, merchant: true, totalCents: true, purchasedAt: true },
    }),
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
  ]);

  // This sentinel exists only inside this pre-obligation review query. It is
  // not an inferred currency and is never persisted: it lets the same cadence
  // search decide whether several priced-but-unitless observations are worth
  // asking the owner about.
  const needsByMerchant = new Map<string, {
    merchantCanonicalId: string;
    cadence: unknown;
    evidence: Array<{ id: string; occurredAt: Date }>;
  }>();
  const candidates = clusterRecurringPurchases(unresolvedPurchases.map((purchase) => ({
    id: purchase.id,
    userId,
    canonicalMerchantId: purchase.merchant,
    currency: UNRESOLVED_CURRENCY_SENTINEL,
    amountMinor: purchase.totalCents,
    date: purchase.purchasedAt,
  })), preference?.timezone || DEFAULT_TIME_ZONE);
  for (const candidate of candidates) {
    const current = needsByMerchant.get(candidate.canonicalMerchantId);
    if (current && current.evidence.length >= candidate.purchases.length) continue;
    needsByMerchant.set(candidate.canonicalMerchantId, {
      merchantCanonicalId: candidate.canonicalMerchantId,
      cadence: candidate.cadence.cadence,
      evidence: candidate.purchases.map(({ id, date }) => ({ id, occurredAt: date })),
    });
  }

  return NextResponse.json({
    obligations: rows.map(({ confidenceReasons, ...obligation }) => ({
      ...obligation,
      reasons: readableReasons(confidenceReasons),
    })),
    currencyNeeds: [...needsByMerchant.values()]
      .sort((left, right) => left.merchantCanonicalId.localeCompare(right.merchantCanonicalId)),
  });
}
