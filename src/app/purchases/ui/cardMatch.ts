const FILLER_TOKENS = new Set(["apple", "card", "credit", "debit", "pay", "wallet"]);
const NETWORK_TOKENS = new Set(["amex", "mastercard", "visa"]);

const TOKEN_ALIASES: Record<string, string> = {
  mc: "mastercard",
  scotia: "scotiabank",
};

function normalizedTokens(value: string): string[] {
  const prepared = value
    .toLowerCase()
    .replace(/american\s+express/g, "amex")
    .replace(/master\s+card/g, "mastercard")
    .replace(/[^a-z0-9-]+/g, " ")
    .trim();

  if (!prepared) return [];

  return prepared
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token] ?? token);
}

export function normalizeCardLabel(value: string): string {
  return normalizedTokens(value)
    .filter((token) => !FILLER_TOKENS.has(token))
    .join(" ");
}

function distinctiveTokens(value: string): string[] {
  return normalizedTokens(value).filter(
    (token) => !FILLER_TOKENS.has(token) && !NETWORK_TOKENS.has(token),
  );
}

export type CardMatchScore = {
  exact: boolean;
  score: number;
};

/**
 * Scores a captured Wallet label against a possible card identity.
 * Network-only labels (for example, "Visa") deliberately score zero because
 * they do not identify a product variant safely.
 */
export function scoreCardMatch(cardRaw: string, candidate: string): CardMatchScore {
  const rawLabel = normalizeCardLabel(cardRaw);
  const candidateLabel = normalizeCardLabel(candidate);
  const exact = rawLabel.length > 0 && rawLabel === candidateLabel;
  if (exact) return { exact: true, score: 1 };

  const rawTokens = distinctiveTokens(cardRaw);
  const candidateTokens = distinctiveTokens(candidate);
  if (rawTokens.length === 0 || candidateTokens.length === 0) {
    return { exact: false, score: 0 };
  }

  const rawSet = new Set(rawTokens);
  const candidateSet = new Set(candidateTokens);
  const overlap = [...rawSet].filter((token) => candidateSet.has(token)).length;
  if (overlap === 0) return { exact: false, score: 0 };

  // Prefer covering the captured label while still penalizing a candidate
  // containing many unmatched product words. This keeps "Visa Infinite" from
  // becoming a confident match for every Visa Infinite card.
  const rawCoverage = overlap / rawSet.size;
  const candidateCoverage = overlap / candidateSet.size;
  return {
    exact: false,
    score: rawCoverage * 0.65 + candidateCoverage * 0.35,
  };
}

export type RankedCardMatch<T> = {
  candidate: T;
  exact: boolean;
  score: number;
};

export function rankCardMatches<T>(
  cardRaw: string,
  candidates: T[],
  labels: (candidate: T) => Array<string | undefined>,
): RankedCardMatch<T>[] {
  return candidates
    .map((candidate, index) => {
      const best = labels(candidate).reduce<CardMatchScore>(
        (current, label) => {
          if (!label) return current;
          const next = scoreCardMatch(cardRaw, label);
          return next.score > current.score || (next.exact && !current.exact) ? next : current;
        },
        { exact: false, score: 0 },
      );
      return { candidate, index, ...best };
    })
    .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || a.index - b.index)
    .map(({ candidate, exact, score }) => ({ candidate, exact, score }));
}

const CONFIDENCE_THRESHOLD = 0.82;
const CONFIDENCE_MARGIN = 0.12;

export function confidentCardMatch<T>(matches: RankedCardMatch<T>[]): T | null {
  const [best, runnerUp] = matches;
  if (!best || best.score < CONFIDENCE_THRESHOLD) return null;
  if (best.exact) return runnerUp?.exact ? null : best.candidate;

  const runnerUpScore = runnerUp?.score ?? 0;
  return best.score - runnerUpScore >= CONFIDENCE_MARGIN ? best.candidate : null;
}

export function cardLabelsMatchSearch(labels: Array<string | undefined>, query: string): boolean {
  const normalizedQuery = normalizeCardLabel(query);
  if (!normalizedQuery) return true;
  const queryTokens = normalizedQuery.split(" ");
  return labels.some((label) => {
    if (!label) return false;
    const labelTokens = new Set(normalizeCardLabel(label).split(" "));
    return queryTokens.every((token) => labelTokens.has(token));
  });
}
