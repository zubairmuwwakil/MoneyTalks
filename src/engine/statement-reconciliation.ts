export type StatementLine = {
  id: string;
  date: string;
  amountMinor: number;
  description: string;
};

export type CapturedPurchase = {
  id: string;
  date: string;
  amountMinor: number;
  merchant: string;
  source: "purchase" | "wallet";
};

export type ReconciliationStatus = "matched" | "unmatched" | "ambiguous" | "excluded";

export type ReconciledStatementLine = StatementLine & {
  status: ReconciliationStatus;
  matchedCandidateId?: string;
  matchedMerchant?: string;
};

export type MerchantAliases = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

const NON_MERCHANT_WORDS = new Set([
  "AUTH", "AUTOMATIC", "CARD", "DEBIT", "MASTERCARD", "ONLINE", "PAYMENT", "POS", "PURCHASE", "VISA",
]);
const CREDIT_OR_PAYMENT = /\b(payment|refund|reversal|return|cashback)\b|\bcredit\s+(?:adjustment|memo|interest|balance)\b/i;

function aliasFor(value: string, aliases?: MerchantAliases): string | undefined {
  if (!aliases) return undefined;
  const key = value.trim().toLocaleLowerCase();
  const mapGet = (aliases as ReadonlyMap<string, string>).get;
  if (typeof mapGet === "function") return mapGet.call(aliases, key);
  return (aliases as Readonly<Record<string, string>>)[key];
}

/**
 * Produces a comparison key for unaliased statement text. Database aliases are
 * consulted first, so Wallet's curated merchant normalization stays canonical.
 */
export function normalizeMerchantForMatch(value: string, aliases?: MerchantAliases): string {
  const aliased = aliasFor(value, aliases);
  const source = aliased ?? value;
  return source
    .toLocaleLowerCase()
    .replace(/\b(?:\d{4,}|#\d+|\d{1,3}[a-z]\d+)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1 && !NON_MERCHANT_WORDS.has(word.toUpperCase()))
    .join(" ")
    .trim();
}

function dateDistanceDays(a: string, b: string): number {
  const aMs = Date.parse(`${a}T00:00:00Z`);
  const bMs = Date.parse(`${b}T00:00:00Z`);
  return Math.round(Math.abs(aMs - bMs) / 86_400_000);
}

/** A compact token score; containment handles common statement suffixes such as store numbers. */
export function merchantSimilarity(a: string, b: string, aliases?: MerchantAliases): number {
  const left = normalizeMerchantForMatch(a, aliases);
  const right = normalizeMerchantForMatch(b, aliases);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.9;
  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  let overlap = 0;
  for (const word of leftWords) if (rightWords.has(word)) overlap += 1;
  return (2 * overlap) / (leftWords.size + rightWords.size);
}

export function isExcludedStatementLine(line: Pick<StatementLine, "amountMinor" | "description">): boolean {
  return line.amountMinor <= 0 || CREDIT_OR_PAYMENT.test(line.description);
}

/**
 * Matches an upload without database access. Candidates are consumed only for
 * decisive matches, preventing one captured purchase from covering two lines.
 */
export function reconcileStatementLines(
  lines: StatementLine[],
  candidates: CapturedPurchase[],
  aliases?: MerchantAliases,
): ReconciledStatementLine[] {
  const consumed = new Set<string>();

  return lines.map((line) => {
    if (isExcludedStatementLine(line)) return { ...line, status: "excluded" };

    const eligible = candidates
      .filter((candidate) =>
        !consumed.has(candidate.id) &&
        candidate.amountMinor === line.amountMinor &&
        dateDistanceDays(candidate.date, line.date) <= 3,
      )
      .map((candidate) => ({
        candidate,
        similarity: merchantSimilarity(line.description, candidate.merchant, aliases),
        dateDistance: dateDistanceDays(candidate.date, line.date),
      }));

    if (eligible.length === 0) return { ...line, status: "unmatched" };
    eligible.sort((a, b) => b.similarity - a.similarity || a.dateDistance - b.dateDistance || a.candidate.id.localeCompare(b.candidate.id));
    const winner = eligible[0];
    const tied = eligible.filter(
      (entry) => entry.similarity === winner.similarity && entry.dateDistance === winner.dateDistance,
    );
    if (tied.length > 1) return { ...line, status: "ambiguous" };

    consumed.add(winner.candidate.id);
    return {
      ...line,
      status: "matched",
      matchedCandidateId: winner.candidate.id,
      matchedMerchant: winner.candidate.merchant,
    };
  });
}

export function coverageForLines(lines: ReconciledStatementLine[]): { matchedLines: number; eligibleLines: number; percentage: number } {
  const eligibleLines = lines.filter((line) => line.status !== "excluded");
  const matchedLines = eligibleLines.filter((line) => line.status === "matched").length;
  return {
    matchedLines,
    eligibleLines: eligibleLines.length,
    percentage: eligibleLines.length === 0 ? 0 : Math.round((matchedLines / eligibleLines.length) * 100),
  };
}
