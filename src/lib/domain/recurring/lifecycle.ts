import type { Cadence } from "@/engine/recurrence";
import type { ObligationFact, ObligationFactSource, ObligationStatus } from "./types";

const DAY_MS = 86_400_000;

const PERIOD_DAYS: Readonly<Record<Cadence["type"], number>> = Object.freeze({
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  QUARTERLY: 91,
  SEMIANNUAL: 182,
  ANNUAL: 365,
});

function requireValidDate(date: Date, label: string): void {
  if (!Number.isFinite(date.getTime())) throw new RangeError(`${label} must be a valid Date`);
}

interface LifecycleState {
  cancellation?: Extract<ObligationFact, { type: "CANCELLATION" }>;
  hasTrial: boolean;
  lastCharge?: Date;
  activeAssertion?: Date;
}

const SOURCE_PRECEDENCE: Readonly<Record<ObligationFactSource, number>> = Object.freeze({
  PURCHASE: 0,
  EMAIL: 1,
  OWNER: 2,
});

function sourcePrecedence(fact: ObligationFact): number {
  // Untagged historical call-sites are purchase observations. This preserves
  // their old behaviour while canonical readers tag the source explicitly.
  return SOURCE_PRECEDENCE[fact.source ?? "PURCHASE"];
}

/**
 * Fold evidence in temporal order. A later charge clears an older cancellation
 * naturally, which is why resubscription needs no precedence exception.
 */
export function deriveObligationStatus(
  facts: readonly ObligationFact[],
  cadence: Cadence,
  asOf: Date,
): ObligationStatus | null {
  requireValidDate(asOf, "asOf");
  const ordered = facts.map((fact, index) => {
    requireValidDate(fact.occurredAt, "fact timestamp");
    if ("effectiveAt" in fact && fact.effectiveAt) requireValidDate(fact.effectiveAt, "fact effective timestamp");
    if (fact.type === "NEXT_BILLING_DATE") requireValidDate(fact.billingAt, "next billing timestamp");
    return { fact, index };
  }).sort((a, b) => (
    a.fact.occurredAt.getTime() - b.fact.occurredAt.getTime()
    || sourcePrecedence(a.fact) - sourcePrecedence(b.fact)
    || a.index - b.index
  ));

  const state = ordered.reduce<LifecycleState>((current, { fact }) => {
    switch (fact.type) {
      case "CHARGE":
        return { ...current, cancellation: undefined, hasTrial: false, lastCharge: fact.occurredAt };
      case "ACTIVATION":
      case "RESUMPTION":
        return { ...current, cancellation: undefined, hasTrial: false, activeAssertion: fact.occurredAt };
      case "CANCELLATION":
        return { ...current, cancellation: fact };
      case "TRIAL_STARTED":
      case "TRIAL_ENDED":
        return current.lastCharge ? current : { ...current, hasTrial: true };
      default:
        return current;
    }
  }, { hasTrial: false });

  if (state.cancellation) {
    // A cancellation without a stated end date is still a live cancellation,
    // not evidence that service has already stopped.
    if (!state.cancellation.effectiveAt || state.cancellation.effectiveAt.getTime() > asOf.getTime()) {
      return "CANCELLING";
    }
    return "CANCELLED";
  }
  if (!state.lastCharge) {
    if (state.hasTrial) return "TRIALING";
    return state.activeAssertion ? "ACTIVE" : null;
  }

  const ageDays = (asOf.getTime() - state.lastCharge.getTime()) / DAY_MS;
  const periodDays = PERIOD_DAYS[cadence.type];
  if (ageDays <= periodDays * 1.5) return "ACTIVE";
  if (ageDays > periodDays * 2) return "LAPSED";

  // The design intentionally leaves the grace band between 1.5x and 2x
  // unnamed. Returning null is more honest than guessing active or lapsed.
  return null;
}
