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

/** A fact supplied by the purchase spine or a receipt; it is never derived state. */
export type ObligationFact =
  | { type: "CHARGE"; occurredAt: Date }
  | { type: "EXPLICIT_CADENCE"; occurredAt: Date; cadence: Cadence["type"] }
  | { type: "EXPLICIT_RECURRING"; occurredAt: Date }
  | { type: "CANCELLATION"; occurredAt: Date; effectiveAt?: Date }
  | { type: "TRIAL_STARTED"; occurredAt: Date; effectiveAt?: Date }
  | { type: "TRIAL_ENDED"; occurredAt: Date; effectiveAt?: Date }
  | { type: "PRICE_CHANGE"; occurredAt: Date; effectiveAt?: Date; amountMinor?: number }
  | { type: "NEXT_BILLING_DATE"; occurredAt: Date; billingAt: Date };

/** Derived at sweep time from facts; it must never become a mutable column. */
export type ObligationStatus = "TRIALING" | "ACTIVE" | "CANCELLING" | "CANCELLED" | "LAPSED";
