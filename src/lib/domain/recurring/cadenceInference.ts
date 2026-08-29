import type { Cadence } from "@/engine/recurrence";
import type { CadenceInferenceResult } from "./types";

const DAY_MS = 86_400_000;

interface CandidateDefinition {
  periodDays: number;
  toleranceDays: number;
  type: Cadence["type"];
}

interface LocalDate {
  dayOfMonth: number;
  iso: string;
  ordinal: number;
}

interface EvaluatedCandidate {
  cadence: Cadence;
  coverage: number;
  mad: number;
  matched: number;
  score: number;
  periodDays: number;
}

// Biweekly/monthly use the same four-day operational allowance. Longer
// calendar cadences get the annual allowance so short/long months and billing
// retries do not turn a real obligation into a miss.
const CANDIDATES: readonly CandidateDefinition[] = [
  { periodDays: 7, toleranceDays: 2, type: "WEEKLY" },
  { periodDays: 14, toleranceDays: 4, type: "BIWEEKLY" },
  { periodDays: 30, toleranceDays: 4, type: "MONTHLY" },
  { periodDays: 91, toleranceDays: 10, type: "QUARTERLY" },
  { periodDays: 182, toleranceDays: 10, type: "SEMIANNUAL" },
  { periodDays: 365, toleranceDays: 10, type: "ANNUAL" },
];

function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianAbsoluteDeviation(values: readonly number[]): number {
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

function localDate(date: Date, formatter: Intl.DateTimeFormat): LocalDate {
  if (!Number.isFinite(date.getTime())) throw new RangeError("cadence dates must be valid Dates");

  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((candidate) => candidate.type === type)?.value);
    if (!Number.isInteger(value)) throw new RangeError(`could not read ${type} from cadence date`);
    return value;
  };
  const year = part("year");
  const month = part("month");
  const dayOfMonth = part("day");
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${dayOfMonth.toString().padStart(2, "0")}`;

  return {
    dayOfMonth,
    iso,
    ordinal: Math.trunc(Date.UTC(year, month - 1, dayOfMonth) / DAY_MS),
  };
}

function compareChains(a: readonly LocalDate[], b: readonly LocalDate[]): number {
  if (a.length !== b.length) return a.length - b.length;
  if (a.length < 2) return a.at(-1)!.ordinal - b.at(-1)!.ordinal;

  const gaps = (chain: readonly LocalDate[]) => chain.slice(1).map((date, index) => date.ordinal - chain[index].ordinal);
  const aMad = medianAbsoluteDeviation(gaps(a));
  const bMad = medianAbsoluteDeviation(gaps(b));
  if (aMad !== bMad) return bMad - aMad;
  return a.at(-1)!.ordinal - b.at(-1)!.ordinal;
}

/** Exact longest path through the date DAG; deterministic tie-breaks favour lower MAD. */
function longestSubsequence(
  dates: readonly LocalDate[],
  periodDays: number,
  toleranceDays: number,
): LocalDate[] {
  const endingAt: LocalDate[][] = [];

  for (let current = 0; current < dates.length; current += 1) {
    let best = [dates[current]];
    for (let previous = 0; previous < current; previous += 1) {
      const gap = dates[current].ordinal - dates[previous].ordinal;
      const elapsedPeriods = Math.max(1, Math.round(gap / periodDays));
      // Missing observations leave holes in the cadence grid; they do not
      // split a clean history into two unrelated fragments.
      if (Math.abs(gap - elapsedPeriods * periodDays) > toleranceDays) continue;
      const extended = [...endingAt[previous], dates[current]];
      if (compareChains(extended, best) > 0) best = extended;
    }
    endingAt.push(best);
  }

  return endingAt.reduce((best, chain) => compareChains(chain, best) > 0 ? chain : best, []);
}

function cadenceFor(definition: CandidateDefinition, matched: readonly LocalDate[]): Cadence {
  if (definition.type === "MONTHLY") {
    return {
      type: "MONTHLY",
      dayOfMonth: Math.round(median(matched.map((date) => date.dayOfMonth))),
    };
  }

  const anchor = matched.at(-1)!.iso;
  switch (definition.type) {
    case "WEEKLY":
      return { type: "WEEKLY", anchor };
    case "BIWEEKLY":
      return { type: "BIWEEKLY", anchor };
    case "QUARTERLY":
      return { type: "QUARTERLY", anchor };
    case "SEMIANNUAL":
      return { type: "SEMIANNUAL", anchor };
    case "ANNUAL":
      return { type: "ANNUAL", anchor };
    default: {
      const exhaustive: never = definition.type;
      return exhaustive;
    }
  }
}

function evaluate(definition: CandidateDefinition, dates: readonly LocalDate[]): EvaluatedCandidate {
  const subsequence = longestSubsequence(dates, definition.periodDays, definition.toleranceDays);
  const gaps = subsequence.slice(1).map((date, index) => {
    const gap = date.ordinal - subsequence[index].ordinal;
    return gap / Math.max(1, Math.round(gap / definition.periodDays));
  });
  const medianGap = gaps.length > 0 ? median(gaps) : definition.periodDays;
  const mad = gaps.length > 0 ? medianAbsoluteDeviation(gaps) : 0;
  const span = dates.length > 1 ? dates.at(-1)!.ordinal - dates[0].ordinal : 0;
  const expectedInSpan = Math.max(1, Math.round(span / definition.periodDays) + 1);
  const coverage = Math.min(1, subsequence.length / expectedInSpan);
  const regularity = Math.max(0, 1 - mad / medianGap);

  return {
    cadence: cadenceFor(definition, subsequence),
    coverage,
    mad,
    matched: subsequence.length,
    score: coverage * regularity,
    periodDays: definition.periodDays,
  };
}

function isBetter(candidate: EvaluatedCandidate, incumbent: EvaluatedCandidate): boolean {
  // Prefer the fundamental cadence over a clean harmonic made from every
  // second/third occurrence. A jittered weekly history can otherwise look
  // more perfectly biweekly after half its evidence is discarded.
  if (candidate.matched !== incumbent.matched) return candidate.matched > incumbent.matched;
  if (candidate.score !== incumbent.score) return candidate.score > incumbent.score;
  if (candidate.mad !== incumbent.mad) return candidate.mad < incumbent.mad;
  return candidate.periodDays < incumbent.periodDays;
}

/**
 * Infer only a cadence supported by at least three regular local-calendar dates.
 * `null` means that the evidence is not strong enough to name a cadence.
 */
export function inferCadence(
  dates: readonly Date[],
  timeZone: string,
): CadenceInferenceResult | null {
  if (dates.length < 3) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
  });
  const normalized = [...new Map(
    dates.map((date) => {
      const normalizedDate = localDate(date, formatter);
      return [normalizedDate.ordinal, normalizedDate] as const;
    }),
  ).values()].sort((a, b) => a.ordinal - b.ordinal);

  if (normalized.length < 3) return null;

  const evaluated = CANDIDATES
    .map((candidate) => ({ definition: candidate, result: evaluate(candidate, normalized) }))
    .filter(({ definition, result }) => (
      result.matched >= 3
      && result.coverage >= 0.75
      && result.mad <= definition.toleranceDays
    ));
  if (evaluated.length === 0) return null;

  const best = evaluated
    .map(({ result }) => result)
    .reduce((incumbent, candidate) => isBetter(candidate, incumbent) ? candidate : incumbent);
  return { cadence: best.cadence, coverage: best.coverage, mad: best.mad };
}
