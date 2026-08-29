import type { Cadence, ScheduleEntry } from "@/engine/recurrence";

/** One monetary occurrence, before merchant/cadence clustering adds context. */
export interface Observation<Currency extends string = string> {
  date: Date;
  amountMinor: number;
  currency: Currency;
}

export type AmountPattern = "FIXED" | "VARIABLE" | "USAGE_BASED";

export interface CadenceInferenceResult {
  cadence: Cadence;
  coverage: number;
  /** Median absolute deviation of the matched gaps, in days. */
  mad: number;
}

export interface AmountPatternResult {
  pattern: AmountPattern;
  schedule: ScheduleEntry[];
}
