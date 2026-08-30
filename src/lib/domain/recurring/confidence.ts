import type { CandidateCluster } from "./clustering";
import { findPackMerchantById } from "@/lib/domain/merchants/merchantPack";
import type { ObligationFact } from "./types";

export type ConfidenceReasonCode =
  | "REGULAR_OCCURRENCES"
  | "MANY_OCCURRENCES"
  | "EXPLICIT_CADENCE"
  | "EXPLICIT_RECURRING"
  | "KNOWN_MERCHANT"
  | "FIXED_AMOUNT"
  | "CANCELLED_AFTER_LAST_CHARGE"
  | "THIN_EVIDENCE"
  | "SHAKY_CADENCE";

export interface ConfidenceReason {
  code: ConfidenceReasonCode;
  delta: number;
  /** A display-ready sentence, never serialized diagnostic data. */
  detail: string;
}

export interface ConfidenceResult {
  score: number;
  reasons: ConfidenceReason[];
}

export interface ConfidenceOptions {
  /** Resolved by orchestration from merchant-pack or a recurring category. */
  knownMerchant?: boolean;
  /** The human-facing name used in explanations; canonical id is the fallback. */
  merchantName?: string;
}

// INITIAL weights: tune these against future confirm/dismiss data, not intuition.
export const INITIAL_CONFIDENCE_WEIGHTS: Readonly<Record<ConfidenceReasonCode, number>> = Object.freeze({
  REGULAR_OCCURRENCES: 0.35,
  MANY_OCCURRENCES: 0.15,
  EXPLICIT_CADENCE: 0.20,
  EXPLICIT_RECURRING: 0.15,
  KNOWN_MERCHANT: 0.10,
  FIXED_AMOUNT: 0.10,
  CANCELLED_AFTER_LAST_CHARGE: -0.40,
  THIN_EVIDENCE: -0.30,
  SHAKY_CADENCE: -0.20,
});

const TOLERANCE_DAYS: Readonly<Record<CandidateCluster["cadence"]["cadence"]["type"], number>> = Object.freeze({
  WEEKLY: 2,
  BIWEEKLY: 4,
  MONTHLY: 4,
  QUARTERLY: 10,
  SEMIANNUAL: 10,
  ANNUAL: 10,
});

function hasFact(facts: readonly ObligationFact[], type: ObligationFact["type"]): boolean {
  return facts.some((fact) => fact.type === type);
}

function isCancelledAfterLastCharge(cluster: CandidateCluster, facts: readonly ObligationFact[]): boolean {
  const lastCharge = cluster.purchases.at(-1)?.date;
  if (!lastCharge) return false;
  return facts.some((fact) => fact.type === "CANCELLATION" && fact.occurredAt.getTime() > lastCharge.getTime());
}

/** The only legitimate route for detecting a new annual obligation after two charges. */
export function hasSufficientRecurringEvidence(occurrenceCount: number, facts: readonly ObligationFact[]): boolean {
  const hasStatedAmount = facts.some((fact) => "amountMinor" in fact && fact.amountMinor !== undefined);
  return occurrenceCount >= 3
    || (occurrenceCount === 2 && hasFact(facts, "EXPLICIT_CADENCE"))
    || (
      occurrenceCount === 0
      && hasFact(facts, "EXPLICIT_CADENCE")
      && (hasStatedAmount || hasFact(facts, "NEXT_BILLING_DATE"))
    );
}

/** Score an already-detected candidate. It orders review; it never gates review creation. */
export function scoreRecurringConfidence(
  cluster: CandidateCluster,
  facts: readonly ObligationFact[],
  options: ConfidenceOptions = {},
): ConfidenceResult {
  const reasons: ConfidenceReason[] = [];
  const occurrenceCount = cluster.purchases.length;
  const merchant = options.merchantName?.trim() || cluster.canonicalMerchantId;
  const period = Math.round({
    WEEKLY: 7,
    BIWEEKLY: 14,
    MONTHLY: 30,
    QUARTERLY: 91,
    SEMIANNUAL: 182,
    ANNUAL: 365,
  }[cluster.cadence.cadence.type]);
  const add = (code: ConfidenceReasonCode, detail: string) => {
    reasons.push({ code, delta: INITIAL_CONFIDENCE_WEIGHTS[code], detail });
  };

  if (occurrenceCount >= 3) {
    add("REGULAR_OCCURRENCES", `${occurrenceCount} ${merchant} charges, about ${period} days apart.`);
  }
  if (occurrenceCount >= 6) add("MANY_OCCURRENCES", `${merchant} has ${occurrenceCount} observed charges.`);
  if (hasFact(facts, "EXPLICIT_CADENCE")) add("EXPLICIT_CADENCE", `An email explicitly states this billing cadence.`);
  if (hasFact(facts, "EXPLICIT_RECURRING")) add("EXPLICIT_RECURRING", `An email says ${merchant} renews automatically.`);
  const knownMerchant = options.knownMerchant ?? findPackMerchantById(cluster.canonicalMerchantId) !== null;
  if (knownMerchant) add("KNOWN_MERCHANT", `${merchant} is a known recurring merchant.`);
  if (cluster.amountPattern.pattern === "FIXED") add("FIXED_AMOUNT", `${merchant} has kept the same charge amount.`);
  if (isCancelledAfterLastCharge(cluster, facts)) {
    add("CANCELLED_AFTER_LAST_CHARGE", `A cancellation was recorded after the latest ${merchant} charge.`);
  }
  if (occurrenceCount === 2 && !hasFact(facts, "EXPLICIT_CADENCE")) {
    add("THIN_EVIDENCE", `Only two ${merchant} charges are available without an explicit cadence.`);
  }
  if (cluster.cadence.mad > TOLERANCE_DAYS[cluster.cadence.cadence.type] / 2) {
    add("SHAKY_CADENCE", `${merchant} charge dates vary more than half the cadence tolerance.`);
  }

  const score = reasons.reduce((total, reason) => total + reason.delta, 0);
  return { score: Math.max(0, Math.min(1, score)), reasons };
}
