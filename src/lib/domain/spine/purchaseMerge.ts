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
  // ISO code. Unknown is compatible with a known observation (the latter can
  // enrich the canonical purchase), but two contradictory known codes cannot
  // refer to the same numeric amount.
  currency?: string | null;
  // Ordered by quality: normalized merchant first, raw string fallback.
  merchantCandidates: string[];
  incomingSource: PurchaseSource;
}

export const MATCH_WINDOW_HOURS = 72;

export function orderedPurchasePair(a: string, b: string) {
  return a < b
    ? { purchaseLowId: a, purchaseHighId: b }
    : { purchaseLowId: b, purchaseHighId: a };
}

function canonMerchant(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function merchantsCompatible(a: string, b: string): boolean {
  const ca = canonMerchant(a);
  const cb = canonMerchant(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

function normalizedCurrency(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase() || null;
}

export function currenciesCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizedCurrency(a);
  const right = normalizedCurrency(b);
  return left == null || right == null || left === right;
}

export function scoreCandidate(
  candidate: Pick<Purchase, "merchant" | "totalCents" | "currency" | "purchasedAt">,
  incoming: IncomingObservation,
  windowHours = MATCH_WINDOW_HOURS,
): MatchConfidence | null {
  if (candidate.totalCents == null || candidate.totalCents !== incoming.amountMinor) return null;
  if (!currenciesCompatible(candidate.currency, incoming.currency)) return null;
  const hoursApart =
    Math.abs(candidate.purchasedAt.getTime() - incoming.observedAt.getTime()) / 3_600_000;
  if (hoursApart > windowHours) return null;
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
  const incomingCurrency = normalizedCurrency(incoming.currency);
  const candidates = await db.purchase.findMany({
    where: {
      userId: incoming.userId,
      source: { not: incoming.incomingSource },
      totalCents: incoming.amountMinor,
      ...(incomingCurrency
        ? {
            OR: [
              { currency: null },
              { currency: { equals: incomingCurrency, mode: "insensitive" as const } },
            ],
          }
        : {}),
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
  let confidence: MatchConfidence | null = null;
  let matched: Purchase | null = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, incoming);
    if (score === "exact") {
      matched = candidate;
      confidence = "exact";
      break;
    }
    if (score === "possible" && !possible) possible = candidate;
  }
  if (!matched && possible) {
    matched = possible;
    confidence = "possible";
  }

  // Tuning telemetry: real-data rates for exact/possible/none decide whether
  // the 72h window and merchant rules need adjusting. No merchant names or
  // user ids — the DB rows themselves carry the detail.
  console.log(
    JSON.stringify({
      tag: "merge-decision",
      source: incoming.incomingSource,
      decision: confidence ?? "none",
      amountMinor: incoming.amountMinor,
      candidatesInWindow: candidates.length,
      deltaHours: matched
        ? Math.round(
            (Math.abs(matched.purchasedAt.getTime() - incoming.observedAt.getTime()) / 3_600_000) * 10,
          ) / 10
        : null,
    }),
  );

  return matched && confidence ? { purchase: matched, confidence } : null;
}
