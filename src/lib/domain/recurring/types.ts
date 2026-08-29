import type { Cadence, ScheduleEntry } from "@/engine/recurrence";

/**
 * One occurrence, before merchant/cadence clustering adds context.
 *
 * `amountMinor` is nullable because a real and common class of biller never
 * states a price in the mail: Cloudflare's "Your invoice is available" puts
 * the figure behind a link, so those observations reach us dated but
 * unpriced. They are still evidence — a confident monthly cadence with an
 * unknown amount beats no obligation at all, and beats an invented one.
 */
export interface Observation<Currency extends string = string> {
  date: Date;
  amountMinor: number | null;
  currency: Currency;
}

export type AmountPattern = "FIXED" | "VARIABLE" | "USAGE_BASED" | "UNKNOWN";

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
