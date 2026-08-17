import type { Prisma, PurchaseSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  orderedPurchasePair,
  scoreCandidate,
  type IncomingObservation,
  type MatchConfidence,
} from "./purchaseMerge";

export const RETRO_MERGE_LOOKBACK_DAYS = 7;
export const RETRO_MERGE_WINDOW_HOURS = 7 * 24;

type ObservationCounts = {
  walletEvents: number;
  emailTransactions: number;
  statementLines: number;
};

type SweepPurchase = {
  id: string;
  userId: string;
  merchant: string;
  totalCents: number | null;
  currency: string;
  purchasedAt: Date;
  createdAt: Date;
  source: PurchaseSource;
  possibleDuplicateOfId: string | null;
  _count: ObservationCounts;
};

export type PurchaseMergeSweepResult = {
  scanned: number;
  matched: number;
  flagged: number;
  dismissed: number;
};

function noCrossSourceEvidenceWhere(source: PurchaseSource): Prisma.PurchaseWhereInput {
  if (source === "WALLET") {
    return { emailTransactions: { none: {} }, statementLines: { none: {} } };
  }
  if (source === "GMAIL") {
    return { walletEvents: { none: {} }, statementLines: { none: {} } };
  }
  return {
    walletEvents: { none: {} },
    emailTransactions: { none: {} },
    statementLines: { none: {} },
  };
}

function lacksCrossSourceEvidence(purchase: SweepPurchase): boolean {
  const counts = purchase._count;
  if (purchase.source === "WALLET") {
    return counts.emailTransactions === 0 && counts.statementLines === 0;
  }
  if (purchase.source === "GMAIL") {
    return counts.walletEvents === 0 && counts.statementLines === 0;
  }
  return counts.walletEvents === 0 && counts.emailTransactions === 0 && counts.statementLines === 0;
}

function comparePurchaseAge(a: SweepPurchase, b: SweepPurchase): number {
  const purchasedDelta = a.purchasedAt.getTime() - b.purchasedAt.getTime();
  if (purchasedDelta !== 0) return purchasedDelta;
  const createdDelta = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdDelta !== 0) return createdDelta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pairKey(a: string, b: string): string {
  const pair = orderedPurchasePair(a, b);
  return `${pair.purchaseLowId}\u0000${pair.purchaseHighId}`;
}

function normalizedCurrency(value: string | null | undefined): string {
  return value?.trim().toUpperCase() || "CAD";
}

function bestOlderMatch(
  newer: SweepPurchase,
  purchases: SweepPurchase[],
  unavailableIds: Set<string>,
): { purchase: SweepPurchase; confidence: MatchConfidence } | null {
  if (newer.totalCents == null) return null;
  const incoming: IncomingObservation = {
    userId: newer.userId,
    amountMinor: newer.totalCents,
    observedAt: newer.purchasedAt,
    currency: newer.currency,
    merchantCandidates: [newer.merchant],
    incomingSource: newer.source,
  };

  const matches = purchases.flatMap((candidate) => {
    if (
      candidate.id === newer.id ||
      unavailableIds.has(candidate.id) ||
      candidate.userId !== newer.userId ||
      candidate.source === newer.source ||
      candidate.possibleDuplicateOfId != null ||
      comparePurchaseAge(candidate, newer) >= 0 ||
      normalizedCurrency(candidate.currency) !== normalizedCurrency(newer.currency)
    ) {
      return [];
    }
    const confidence = scoreCandidate(candidate, incoming, RETRO_MERGE_WINDOW_HOURS);
    return confidence ? [{ purchase: candidate, confidence }] : [];
  });

  matches.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "exact" ? -1 : 1;
    const aDelta = newer.purchasedAt.getTime() - a.purchase.purchasedAt.getTime();
    const bDelta = newer.purchasedAt.getTime() - b.purchase.purchasedAt.getTime();
    if (aDelta !== bDelta) return aDelta - bDelta;
    return comparePurchaseAge(b.purchase, a.purchase);
  });
  return matches[0] ?? null;
}

// Daily repair path for races and late observations. This only writes a review
// pointer; it never moves observations, deletes purchases, or touches accruals.
export async function sweepPurchaseDuplicateFlags(
  now = new Date(),
): Promise<PurchaseMergeSweepResult> {
  const lookbackMs = RETRO_MERGE_LOOKBACK_DAYS * 24 * 3_600_000;
  const anchorStart = new Date(now.getTime() - lookbackMs);
  const candidateStart = new Date(anchorStart.getTime() - RETRO_MERGE_WINDOW_HOURS * 3_600_000);

  const purchases = await prisma.purchase.findMany({
    where: {
      purchasedAt: { gte: candidateStart, lte: now },
      possibleDuplicateOfId: null,
      totalCents: { not: null },
    },
    select: {
      id: true,
      userId: true,
      merchant: true,
      totalCents: true,
      currency: true,
      purchasedAt: true,
      createdAt: true,
      source: true,
      possibleDuplicateOfId: true,
      _count: {
        select: { walletEvents: true, emailTransactions: true, statementLines: true },
      },
    },
  });

  const anchors = purchases
    .filter((purchase) => purchase.purchasedAt >= anchorStart && lacksCrossSourceEvidence(purchase))
    .sort(comparePurchaseAge);
  if (anchors.length === 0) return { scanned: 0, matched: 0, flagged: 0, dismissed: 0 };

  const purchaseIds = purchases.map((purchase) => purchase.id);
  const dismissals = await prisma.purchaseDuplicateDismissal.findMany({
    where: {
      purchaseLowId: { in: purchaseIds },
      purchaseHighId: { in: purchaseIds },
    },
    select: { purchaseLowId: true, purchaseHighId: true },
  });
  const dismissedPairs = new Set(
    dismissals.map((dismissal) => pairKey(dismissal.purchaseLowId, dismissal.purchaseHighId)),
  );
  const newlyFlaggedIds = new Set<string>();
  let matched = 0;
  let flagged = 0;
  let dismissed = 0;

  for (const anchor of anchors) {
    const match = bestOlderMatch(anchor, purchases, newlyFlaggedIds);
    if (!match) continue;
    matched++;
    const pair = orderedPurchasePair(anchor.id, match.purchase.id);
    if (dismissedPairs.has(pairKey(anchor.id, match.purchase.id))) {
      dismissed++;
      continue;
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const wasDismissed = await tx.purchaseDuplicateDismissal.findUnique({
        where: {
          userId_purchaseLowId_purchaseHighId: { userId: anchor.userId, ...pair },
        },
        select: { id: true },
      });
      if (wasDismissed) return "dismissed" as const;

      const updated = await tx.purchase.updateMany({
        where: {
          id: anchor.id,
          userId: anchor.userId,
          source: anchor.source,
          possibleDuplicateOfId: null,
          ...noCrossSourceEvidenceWhere(anchor.source),
        },
        data: { possibleDuplicateOfId: match.purchase.id },
      });
      return updated.count === 1 ? "flagged" as const : "stale" as const;
    });

    if (outcome === "dismissed") dismissed++;
    if (outcome === "flagged") {
      flagged++;
      newlyFlaggedIds.add(anchor.id);
    }
  }

  return { scanned: anchors.length, matched, flagged, dismissed };
}
