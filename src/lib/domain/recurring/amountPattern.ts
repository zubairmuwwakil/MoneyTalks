import type { ScheduleEntry } from "@/engine/recurrence";
import type { AmountPattern, AmountPatternResult, Observation } from "./types";

const STABLE_CV = 0.02;
const MIN_RUN_LENGTH = 3;
const MIN_MEAN_CHANGE = 0.02;

interface Run {
  end: number;
  mean: number;
  start: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: readonly number[]): number {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  if (average === 0) return deviation === 0 ? 0 : Number.POSITIVE_INFINITY;
  return deviation / Math.abs(average);
}

function relativeDifference(a: number, b: number): number {
  const denominator = Math.max(Math.abs(a), Math.abs(b));
  if (denominator === 0) return 0;
  return Math.abs(a - b) / denominator;
}

function stableRun(amounts: readonly number[], start: number, end: number): Run | null {
  const values = amounts.slice(start, end);
  if (values.length < MIN_RUN_LENGTH || coefficientOfVariation(values) >= STABLE_CV) return null;
  return { start, end, mean: mean(values) };
}

/**
 * Find locally-supported boundaries, then require every resulting run to be
 * stable. This detects repeated price steps without fitting arbitrary variable
 * bills into a collection of tiny constant segments.
 */
function stableRuns(amounts: readonly number[]): Run[] | null {
  if (amounts.length < MIN_RUN_LENGTH * 2) return null;
  const boundaries: number[] = [];

  for (let boundary = MIN_RUN_LENGTH; boundary <= amounts.length - MIN_RUN_LENGTH; boundary += 1) {
    const left = stableRun(amounts, boundary - MIN_RUN_LENGTH, boundary);
    const right = stableRun(amounts, boundary, boundary + MIN_RUN_LENGTH);
    if (left && right && relativeDifference(left.mean, right.mean) >= MIN_MEAN_CHANGE) {
      boundaries.push(boundary);
    }
  }

  if (boundaries.length === 0) return null;
  const starts = [0, ...boundaries];
  const ends = [...boundaries, amounts.length];
  const runs = starts.map((start, index) => stableRun(amounts, start, ends[index]));
  if (runs.some((run) => run === null)) return null;

  const stable = runs as Run[];
  return stable.every((run, index) => index === 0 || relativeDifference(stable[index - 1].mean, run.mean) >= MIN_MEAN_CHANGE)
    ? stable
    : null;
}

function isoDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError("observation dates must be valid Dates");
  return date.toISOString().slice(0, 10);
}

function previousIsoDate(date: string): string {
  const milliseconds = Date.parse(`${date}T00:00:00.000Z`) - 86_400_000;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function scheduleForRuns(observations: readonly Observation[], runs: readonly Run[]): ScheduleEntry[] {
  return runs.map((run, index) => {
    const next = runs[index + 1];
    return {
      amountMinor: Math.round(run.mean),
      from: isoDate(observations[run.start].date),
      ...(next ? { to: previousIsoDate(isoDate(observations[next.start].date)) } : {}),
    };
  });
}

function patternFor(cv: number): AmountPattern {
  if (cv < 0.02) return "FIXED";
  if (cv < 0.35) return "VARIABLE";
  return "USAGE_BASED";
}

/** Classify one already cadence-matched, single-currency observation series. */
export function inferAmountPattern<Currency extends string>(
  observations: readonly Observation<Currency>[],
): AmountPatternResult {
  if (observations.length === 0) throw new RangeError("amount pattern requires at least one observation");

  // A series can be entirely unpriced — see Observation.amountMinor. Cadence
  // is inferred from dates alone, so such a series is still a real
  // obligation; it just has nothing to classify. An empty schedule is the
  // honest representation, and UNKNOWN keeps it out of the FIXED_AMOUNT
  // confidence term rather than flattering it.
  const priced = observations.filter(
    (observation): observation is Observation<Currency> & { amountMinor: number } =>
      observation.amountMinor !== null,
  );
  if (priced.length === 0) return { pattern: "UNKNOWN", schedule: [] };

  const ordered = [...priced].sort((a, b) => {
    const byDate = a.date.getTime() - b.date.getTime();
    return byDate || a.amountMinor - b.amountMinor || a.currency.localeCompare(b.currency);
  });
  const currency = ordered[0].currency;
  for (const observation of ordered) {
    if (observation.currency !== currency) throw new RangeError("amount pattern observations must share one currency");
    if (!Number.isSafeInteger(observation.amountMinor)) {
      throw new RangeError("observation amounts must be safe integers in minor units");
    }
    isoDate(observation.date);
  }

  const amounts = ordered.map((observation) => observation.amountMinor);
  const runs = stableRuns(amounts);
  if (runs) {
    return {
      pattern: "FIXED",
      schedule: scheduleForRuns(ordered, runs),
    };
  }

  const sortedAmounts = [...amounts].sort((a, b) => a - b);
  const middle = Math.floor(sortedAmounts.length / 2);
  const representative = sortedAmounts.length % 2 === 1
    ? sortedAmounts[middle]
    : Math.round((sortedAmounts[middle - 1] + sortedAmounts[middle]) / 2);

  return {
    pattern: patternFor(coefficientOfVariation(amounts)),
    schedule: [{ amountMinor: representative, from: isoDate(ordered[0].date) }],
  };
}
