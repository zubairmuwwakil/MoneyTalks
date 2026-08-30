import { NextResponse } from "next/server";

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
    return [{
      code: typeof reason.code === "string" ? reason.code : null,
      detail: reason.detail.trim(),
    }];
  });
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const [rows, preference] = await Promise.all([
    prisma.recurringObligation.findMany({
      where: { userId, origin: "DETECTED", needsReview: true },
      include: {
        evidence: { orderBy: { occurredAt: "asc" } },
      },
      orderBy: [{ confidence: "desc" }, { lastObservedAt: "desc" }],
      take: 200,
    }),
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
  ]);

  const currencySummary = await getUnresolvedMerchantCurrencies(
    prisma,
    userId,
    preference?.timezone || DEFAULT_TIME_ZONE,
  );

  const currencyNeeds = currencySummary.merchants
    .filter((m) => m.isRecurringCandidate)
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
