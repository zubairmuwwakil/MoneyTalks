import type { PrismaClient } from "@prisma/client";
import type { Cadence } from "@/engine/recurrence";
import { clusterRecurringPurchases, type CandidateCluster } from "./clustering";

export const UNRESOLVED_CURRENCY_SENTINEL = "__UNRESOLVED_CURRENCY_PROBE__";
export const DEFAULT_TIME_ZONE = "America/Toronto";

export interface UnresolvedPurchaseRecord {
  id: string;
  merchant: string;
  totalCents: number | null;
  currency: string | null;
  currencySource?: string | null;
  purchasedAt: Date;
}

export interface CandidateCadenceSummary {
  cadence: Cadence;
  matchedCount: number;
  coverage: number;
  mad: number;
  occurrences: Array<{ id: string; occurredAt: Date }>;
}

export interface UnresolvedMerchantItem {
  merchantCanonicalId: string;
  unresolvedPurchasesCount: number;
  pricedPurchasesCount: number;
  unpricedPurchasesCount: number;
  totalSpendMinor: number | null;
  isRecurringCandidate: boolean;
  candidateCadence: Cadence | null;
  candidateMatchedPurchases: number;
  candidateCoverage: number;
  candidateMad: number;
  candidateCadenceSummary?: CandidateCadenceSummary | null;
  allCandidateSeries: CandidateCadenceSummary[];
  sampleDates: string[];
  latestPurchaseDate: Date;
  earliestPurchaseDate: Date;
  confirmedCurrency: string | null;
}

export interface UnresolvedCurrenciesSummary {
  totalUnresolvedPurchases: number;
  totalMerchantsCount: number;
  recurringCandidateMerchantsCount: number;
  merchants: UnresolvedMerchantItem[];
  confirmedMerchants: Array<{
    merchantCanonicalId: string;
    currency: string;
    updatedAt: Date;
  }>;
}

/**
 * Evaluates candidate recurrence and metrics for purchases belonging to a single merchant.
 */
export function evaluateMerchantUnresolvedCurrency(
  merchantCanonicalId: string,
  purchases: readonly UnresolvedPurchaseRecord[],
  timeZone: string = DEFAULT_TIME_ZONE,
  confirmedCurrency: string | null = null,
): UnresolvedMerchantItem {
  if (!merchantCanonicalId.trim()) {
    throw new RangeError("merchantCanonicalId must not be empty");
  }
  if (purchases.length === 0) {
    throw new RangeError("purchases list must not be empty");
  }

  const sortedPurchases = [...purchases].sort(
    (a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime(),
  );

  let totalSpendMinor: number | null = null;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const p of sortedPurchases) {
    if (p.totalCents !== null && Number.isSafeInteger(p.totalCents)) {
      pricedCount += 1;
      totalSpendMinor = (totalSpendMinor ?? 0) + p.totalCents;
    } else {
      unpricedCount += 1;
    }
  }

  // Probe recurring cadence using the sentinel currency
  const clusteringPurchases = sortedPurchases.map((p) => ({
    id: p.id,
    userId: "probe-user",
    canonicalMerchantId: merchantCanonicalId,
    discriminator: null,
    currency: UNRESOLVED_CURRENCY_SENTINEL,
    amountMinor: p.totalCents,
    date: p.purchasedAt,
  }));

  const candidateClusters: CandidateCluster[] = clusterRecurringPurchases(
    clusteringPurchases,
    timeZone,
  );

  const allCandidateSeries: CandidateCadenceSummary[] = candidateClusters.map((cluster) => ({
    cadence: cluster.cadence.cadence,
    matchedCount: cluster.purchases.length,
    coverage: cluster.cadence.coverage,
    mad: cluster.cadence.mad,
    occurrences: cluster.purchases.map((p) => ({ id: p.id, occurredAt: p.date })),
  }));

  // Best candidate series sorted by matched count descending, then coverage descending, then lowest MAD
  const bestCandidate = [...allCandidateSeries].sort((a, b) => (
    b.matchedCount - a.matchedCount
    || b.coverage - a.coverage
    || a.mad - b.mad
  ))[0] ?? null;

  const isRecurringCandidate = bestCandidate !== null;
  const sampleDates = sortedPurchases.map((p) => p.purchasedAt.toISOString().slice(0, 10));

  return {
    merchantCanonicalId,
    unresolvedPurchasesCount: sortedPurchases.length,
    pricedPurchasesCount: pricedCount,
    unpricedPurchasesCount: unpricedCount,
    totalSpendMinor,
    isRecurringCandidate,
    candidateCadence: bestCandidate?.cadence ?? null,
    candidateMatchedPurchases: bestCandidate?.matchedCount ?? 0,
    candidateCoverage: bestCandidate?.coverage ?? 0,
    candidateMad: bestCandidate?.mad ?? 0,
    candidateCadenceSummary: bestCandidate,
    allCandidateSeries,
    sampleDates: sampleDates.slice(-5), // 5 most recent dates
    latestPurchaseDate: sortedPurchases[sortedPurchases.length - 1].purchasedAt,
    earliestPurchaseDate: sortedPurchases[0].purchasedAt,
    confirmedCurrency,
  };
}

/**
 * Ranks merchants with unresolved currency by how much they are blocking:
 * 1. Recurring candidates first (regular intervals like monthly/weekly/biweekly),
 *    ordered by candidate matched count, coverage, and lowest MAD.
 * 2. Non-recurring merchants next, ordered by unresolved purchase count (volume),
 *    then latest purchase date.
 */
export function rankUnresolvedMerchants(
  merchants: readonly UnresolvedMerchantItem[],
): UnresolvedMerchantItem[] {
  return [...merchants].sort((a, b) => {
    // 1. Recurring candidates outrank non-recurring merchants
    if (a.isRecurringCandidate !== b.isRecurringCandidate) {
      return a.isRecurringCandidate ? -1 : 1;
    }

    if (a.isRecurringCandidate && b.isRecurringCandidate) {
      // Among recurring candidates:
      // Most matched occurrences first
      if (b.candidateMatchedPurchases !== a.candidateMatchedPurchases) {
        return b.candidateMatchedPurchases - a.candidateMatchedPurchases;
      }
      // Highest coverage next
      if (b.candidateCoverage !== a.candidateCoverage) {
        return b.candidateCoverage - a.candidateCoverage;
      }
      // Lowest MAD (tightest cadence regularity)
      if (a.candidateMad !== b.candidateMad) {
        return a.candidateMad - b.candidateMad;
      }
      // Highest total purchase count
      if (b.unresolvedPurchasesCount !== a.unresolvedPurchasesCount) {
        return b.unresolvedPurchasesCount - a.unresolvedPurchasesCount;
      }
    } else {
      // Among non-recurring merchants:
      // Highest purchase volume first
      if (b.unresolvedPurchasesCount !== a.unresolvedPurchasesCount) {
        return b.unresolvedPurchasesCount - a.unresolvedPurchasesCount;
      }
    }

    // Recency of latest purchase
    if (b.latestPurchaseDate.getTime() !== a.latestPurchaseDate.getTime()) {
      return b.latestPurchaseDate.getTime() - a.latestPurchaseDate.getTime();
    }

    // Deterministic alphabetical fallback
    return a.merchantCanonicalId.localeCompare(b.merchantCanonicalId);
  });
}

/**
 * Queries all unresolved purchases for a user, evaluates merchant recurrence,
 * and returns ranked merchants with full metadata.
 */
export async function getUnresolvedMerchantCurrencies(
  db: PrismaClient,
  userId: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<UnresolvedCurrenciesSummary> {
  if (!userId.trim()) throw new RangeError("userId must be non-empty");

  const [purchases, confirmations] = await Promise.all([
    db.purchase.findMany({
      where: {
        userId,
        OR: [
          { currency: null },
          { currencySource: null },
          { currencySource: "none" },
        ],
      },
      select: {
        id: true,
        merchant: true,
        totalCents: true,
        currency: true,
        currencySource: true,
        purchasedAt: true,
      },
      orderBy: { purchasedAt: "asc" },
    }),
    db.merchantCurrencyConfirmation.findMany({
      where: { userId },
      select: {
        merchantCanonicalId: true,
        currency: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const confirmationMap = new Map(
    confirmations.map((c) => [c.merchantCanonicalId, c.currency]),
  );

  // Group purchases by merchant
  const byMerchant = new Map<string, UnresolvedPurchaseRecord[]>();
  for (const purchase of purchases) {
    const merchant = purchase.merchant.trim();
    if (!merchant) continue;
    const existing = byMerchant.get(merchant) ?? [];
    existing.push(purchase);
    byMerchant.set(merchant, existing);
  }

  const evaluated: UnresolvedMerchantItem[] = [];
  for (const [merchant, merchantPurchases] of byMerchant.entries()) {
    const confirmed = confirmationMap.get(merchant) ?? null;
    evaluated.push(
      evaluateMerchantUnresolvedCurrency(
        merchant,
        merchantPurchases,
        timeZone,
        confirmed,
      ),
    );
  }

  const ranked = rankUnresolvedMerchants(evaluated);
  const recurringCount = ranked.filter((m) => m.isRecurringCandidate).length;

  return {
    totalUnresolvedPurchases: purchases.length,
    totalMerchantsCount: ranked.length,
    recurringCandidateMerchantsCount: recurringCount,
    merchants: ranked,
    confirmedMerchants: confirmations,
  };
}
