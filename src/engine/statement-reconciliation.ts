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

// "matched-tolerant" is an amount-approximate match awaiting a user decision;
// "rejected" is only ever set by that decision, never by this engine.
export type ReconciliationStatus =
  | "matched"
  | "matched-tolerant"
  | "matched-preauth"
  | "unmatched"
  | "ambiguous"
  | "excluded"
  | "rejected";

/** Amount-approximate matches: persisted with their link, but never acted on unconfirmed. */
export const PROPOSED_STATUSES = ["matched-tolerant", "matched-preauth"] as const;

export type ReconciledStatementLine = StatementLine & {
  status: ReconciliationStatus;
  matchedCandidateId?: string;
  matchedMerchant?: string;
  /**
   * The candidate's own amount. The difference from the line is the story:
   * positive means a tip was added after the tap, negative means the statement
   * settled below an authorization hold.
   */
  observedMinor?: number;
};

/**
 * A statement line may exceed the amount actually observed at the till: tips are
 * added after the tap, and a settled pre-auth posts higher than it authorized.
 * The tolerance is therefore ONE-SIDED — a candidate may sit up to 25% below the
 * line, never above. A line of $58.50 accepts a $50.00 capture (a 17% tip); the
 * band is measured against the line, so it absorbs tips up to ~33% of the bill.
 *
 * Note this cannot catch the opposite shape — a gas pre-auth captured at $100
 * that settles at $40 leaves the statement BELOW the observation. Widening the
 * band in that direction would match almost anything, so those stay unmatched.
 */
export const STATEMENT_TOLERANCE_RATIO = 0.25;

/**
 * Tolerant matches trade away amount certainty, so they have to buy it back with
 * merchant evidence. Exact matches keep their historical behaviour of accepting
 * any similarity, because amount + date already identify them.
 */
export const TOLERANT_MERCHANT_SIMILARITY_MIN = 0.5;

/**
 * A settled pre-authorization runs the other way: Wallet captures the hold a
 * pump or hotel authorized, and the statement posts what was actually spent —
 * BELOW the observation. No band can express this ($100 authorized, $47.30
 * settled is a 53% drop), so the amount is dropped from the test entirely and
 * merchant identity carries the whole burden of proof. Hence a floor high
 * enough to demand equality or containment rather than mere token overlap.
 *
 * This does not catch the $1.00 verification probe some pumps authorize, where
 * the capture bears no relation to the settled amount at all. That needs a rule
 * about the probe's shape, not about proximity.
 */
export const PREAUTH_MERCHANT_SIMILARITY_MIN = 0.9;

const DATE_WINDOW_DAYS = 3;

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

type ScoredCandidate = { candidate: CapturedPurchase; similarity: number; dateDistance: number };

/** The lowest candidate amount a line will accept; ceil keeps odd amounts decidable. */
export function minimumTolerantAmountMinor(lineAmountMinor: number): number {
  return Math.ceil(lineAmountMinor * (1 - STATEMENT_TOLERANCE_RATIO));
}

function bestCandidate(
  line: StatementLine,
  candidates: CapturedPurchase[],
  consumed: Set<string>,
  aliases: MerchantAliases | undefined,
  amountFits: (candidateAmountMinor: number, lineAmountMinor: number) => boolean,
  minSimilarity: number,
  /** "tie-break" resolves rivals by score; "strict" refuses to pick among any rivals. */
  uniqueness: "tie-break" | "strict",
): ScoredCandidate | "ambiguous" | null {
  const eligible = candidates
    .filter((candidate) =>
      !consumed.has(candidate.id) &&
      amountFits(candidate.amountMinor, line.amountMinor) &&
      dateDistanceDays(candidate.date, line.date) <= DATE_WINDOW_DAYS,
    )
    .map((candidate) => ({
      candidate,
      similarity: merchantSimilarity(line.description, candidate.merchant, aliases),
      dateDistance: dateDistanceDays(candidate.date, line.date),
    }))
    .filter((entry) => entry.similarity >= minSimilarity);

  if (eligible.length === 0) return null;
  if (uniqueness === "strict" && eligible.length > 1) return "ambiguous";

  eligible.sort((a, b) => b.similarity - a.similarity || a.dateDistance - b.dateDistance || a.candidate.id.localeCompare(b.candidate.id));
  const winner = eligible[0];
  const tied = eligible.filter(
    (entry) => entry.similarity === winner.similarity && entry.dateDistance === winner.dateDistance,
  );
  return tied.length > 1 ? "ambiguous" : winner;
}

/**
 * Each pass is a way a statement amount can legitimately differ from what was
 * observed. Order is load-bearing and is why this is a table rather than three
 * ad-hoc blocks: a purchase is explained by the strongest available story, and
 * a later pass may only claim a line no earlier pass could account for.
 *
 * As the amount test weakens down the list, the other gates tighten to
 * compensate — merchant evidence rises, and rival candidates stop being
 * tie-broken and start being refused outright.
 */
const MATCH_PASSES: ReadonlyArray<{
  status: "matched" | "matched-tolerant" | "matched-preauth";
  amountFits: (candidateAmountMinor: number, lineAmountMinor: number) => boolean;
  minSimilarity: number;
  uniqueness: "tie-break" | "strict";
}> = [
  {
    status: "matched",
    amountFits: (candidate, line) => candidate === line,
    minSimilarity: 0,
    uniqueness: "tie-break",
  },
  {
    status: "matched-tolerant",
    amountFits: (candidate, line) => candidate < line && candidate >= minimumTolerantAmountMinor(line),
    minSimilarity: TOLERANT_MERCHANT_SIMILARITY_MIN,
    uniqueness: "strict",
  },
  {
    status: "matched-preauth",
    amountFits: (candidate, line) => candidate > line,
    minSimilarity: PREAUTH_MERCHANT_SIMILARITY_MIN,
    uniqueness: "strict",
  },
];

/**
 * Matches an upload without database access. Candidates are consumed only for
 * decisive matches, preventing one captured purchase from covering two lines.
 *
 * Every pass runs across the WHOLE upload before the next begins, so an exact
 * amount always wins over an approximate one regardless of row order — a single
 * interleaved pass would let an early tipped line consume the very capture a
 * later line matches to the cent. Ambiguity is terminal: a line with rival
 * candidates is not retried against a looser rule, because loosening cannot
 * break a tie it has already lost.
 */
export function reconcileStatementLines(
  lines: StatementLine[],
  candidates: CapturedPurchase[],
  aliases?: MerchantAliases,
): ReconciledStatementLine[] {
  const consumed = new Set<string>();
  const resolved: ReconciledStatementLine[] = lines.map((line) =>
    isExcludedStatementLine(line) ? { ...line, status: "excluded" } : { ...line, status: "unmatched" },
  );

  for (const pass of MATCH_PASSES) {
    resolved.forEach((line, index) => {
      if (line.status !== "unmatched") return;
      const outcome = bestCandidate(
        line, candidates, consumed, aliases, pass.amountFits, pass.minSimilarity, pass.uniqueness,
      );
      if (outcome === null) return;
      if (outcome === "ambiguous") {
        resolved[index] = { ...line, status: "ambiguous" };
        return;
      }
      consumed.add(outcome.candidate.id);
      resolved[index] = {
        ...line,
        status: pass.status,
        matchedCandidateId: outcome.candidate.id,
        matchedMerchant: outcome.candidate.merchant,
        observedMinor: outcome.candidate.amountMinor,
      };
    });
  }

  return resolved;
}

/**
 * Coverage counts exact matches only. Proposals are reported alongside rather
 * than folded in, so a stored CoverageReport keeps meaning the same thing before
 * and after these rules shipped; a confirmed proposal becomes "matched" and
 * joins the headline number then.
 */
export function coverageForLines(lines: ReconciledStatementLine[]): {
  matchedLines: number;
  proposedLines: number;
  eligibleLines: number;
  percentage: number;
} {
  const eligibleLines = lines.filter((line) => line.status !== "excluded");
  const matchedLines = eligibleLines.filter((line) => line.status === "matched").length;
  const proposed: ReadonlySet<string> = new Set(PROPOSED_STATUSES);
  return {
    matchedLines,
    proposedLines: eligibleLines.filter((line) => proposed.has(line.status)).length,
    eligibleLines: eligibleLines.length,
    percentage: eligibleLines.length === 0 ? 0 : Math.round((matchedLines / eligibleLines.length) * 100),
  };
}
