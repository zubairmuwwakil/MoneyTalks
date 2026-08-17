import type { Prisma, Purchase, PurchaseSource } from "@prisma/client";

// Cross-source purchase matching: decides whether an incoming observation
// (Wallet tap, email receipt) is the same real-world purchase as an existing
// Purchase from a DIFFERENT source. Deliberately conservative — amount+time
// alone is never enough to merge, only to flag a possible duplicate.

export type MatchConfidence = "exact" | "possible";

export interface IncomingObservation {
  userId: string;
  amountMinor: number;
  observedAt: Date;
  // Ordered by quality: normalized merchant first, raw string fallback.
  merchantCandidates: string[];
  incomingSource: PurchaseSource;
}

export const MATCH_WINDOW_HOURS = 72;

function canonMerchant(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function merchantsCompatible(a: string, b: string): boolean {
  const ca = canonMerchant(a);
  const cb = canonMerchant(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

export function scoreCandidate(
  candidate: Pick<Purchase, "merchant" | "totalCents" | "purchasedAt">,
  incoming: IncomingObservation,
): MatchConfidence | null {
  if (candidate.totalCents == null || candidate.totalCents !== incoming.amountMinor) return null;
  const hoursApart =
    Math.abs(candidate.purchasedAt.getTime() - incoming.observedAt.getTime()) / 3_600_000;
  if (hoursApart > MATCH_WINDOW_HOURS) return null;
  const compatible = incoming.merchantCandidates.some(
    (m) => m && merchantsCompatible(m, candidate.merchant),
  );
  return compatible ? "exact" : "possible";
}

type MergeDb = Pick<Prisma.TransactionClient, "purchase">;

// Candidates come only from other sources (same-source dedup is handled by
// unique source keys and the wallet fuzzy-dup check), and only purchases that
// have not already consumed an observation of the incoming type — two $6.42
// taps an hour apart are two coffees, not one.
export async function findMatchingPurchase(
  db: MergeDb,
  incoming: IncomingObservation,
): Promise<{ purchase: Purchase; confidence: MatchConfidence } | null> {
  const windowMs = MATCH_WINDOW_HOURS * 3_600_000;
  const candidates = await db.purchase.findMany({
    where: {
      userId: incoming.userId,
      source: { not: incoming.incomingSource },
      totalCents: incoming.amountMinor,
      purchasedAt: {
        gte: new Date(incoming.observedAt.getTime() - windowMs),
        lte: new Date(incoming.observedAt.getTime() + windowMs),
      },
      ...(incoming.incomingSource === "WALLET" ? { walletEvents: { none: {} } } : {}),
      ...(incoming.incomingSource === "GMAIL" ? { emailTransactions: { none: {} } } : {}),
    },
    orderBy: { purchasedAt: "asc" },
    take: 10,
  });

  let possible: Purchase | null = null;
  for (const candidate of candidates) {
    const confidence = scoreCandidate(candidate, incoming);
    if (confidence === "exact") return { purchase: candidate, confidence };
    if (confidence === "possible" && !possible) possible = candidate;
  }
  return possible ? { purchase: possible, confidence: "possible" } : null;
}
