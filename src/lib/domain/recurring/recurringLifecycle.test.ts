import { describe, expect, it } from "vitest";
import { inferAmountPattern } from "./amountPattern";
import { scoreRecurringConfidence, hasSufficientRecurringEvidence } from "./confidence";
import { extractEmailSignals } from "./emailSignals";
import { deriveObligationStatus } from "./lifecycle";
import type { CandidateCluster } from "./clustering";
import type { ObligationFact, Observation } from "./types";

function date(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

function monthlyCluster(dates: readonly string[], amounts: readonly number[] = dates.map(() => 1_599)): CandidateCluster {
  const purchases = dates.map((iso, index) => ({
    id: `purchase-${index}`,
    userId: "user-1",
    canonicalMerchantId: "spotify",
    currency: "CAD",
    date: date(iso),
    amountMinor: amounts[index],
  }));
  return {
    userId: "user-1",
    canonicalMerchantId: "spotify",
    currency: "CAD",
    discriminator: null,
    purchases,
    cadence: { cadence: { type: "MONTHLY", dayOfMonth: 15 }, coverage: 1, mad: 0 },
    amountPattern: inferAmountPattern(purchases),
  };
}

const monthlyCadence = { type: "MONTHLY", dayOfMonth: 15 } as const;

describe("P4c recurring lifecycle", () => {
  it("subscription-cancellation: derives CANCELLED and lowers confidence", () => {
    const cluster = monthlyCluster(["2026-01-15", "2026-02-15", "2026-03-15"]);
    const cancellation: ObligationFact = {
      type: "CANCELLATION",
      occurredAt: date("2026-03-20"),
      effectiveAt: date("2026-03-31"),
    };

    expect(deriveObligationStatus([...cluster.purchases.map(({ date: occurredAt }) => ({ type: "CHARGE" as const, occurredAt })), cancellation], monthlyCadence, date("2026-04-02"))).toBe("CANCELLED");
    const withoutCancellation = scoreRecurringConfidence(cluster, [], { knownMerchant: true, merchantName: "Spotify" });
    const withCancellation = scoreRecurringConfidence(cluster, [cancellation], { knownMerchant: true, merchantName: "Spotify" });
    expect(withCancellation.score).toBeLessThan(withoutCancellation.score);
    expect(withCancellation.reasons).toContainEqual(expect.objectContaining({ code: "CANCELLED_AFTER_LAST_CHARGE", delta: -0.4 }));
  });

  it("cancel-then-resubscribe: a later charge naturally wins and becomes ACTIVE", () => {
    const facts: ObligationFact[] = [
      { type: "CHARGE", occurredAt: date("2026-01-15") },
      { type: "CANCELLATION", occurredAt: date("2026-01-20"), effectiveAt: date("2026-01-31") },
      { type: "CHARGE", occurredAt: date("2026-02-15") },
    ];
    expect(deriveObligationStatus(facts, monthlyCadence, date("2026-02-20"))).toBe("ACTIVE");
  });

  it("uses owner, then email, then purchase precedence for equal-time facts", () => {
    const occurredAt = date("2026-02-01");
    const facts: ObligationFact[] = [
      { type: "CANCELLATION", occurredAt, source: "PURCHASE" },
      { type: "CHARGE", occurredAt, source: "EMAIL" },
      { type: "CANCELLATION", occurredAt, source: "OWNER" },
    ];

    expect(deriveObligationStatus(facts, monthlyCadence, date("2026-02-02"))).toBe("CANCELLING");
  });

  it("clears an earlier cancellation when the owner explicitly resumes", () => {
    const facts: ObligationFact[] = [
      { type: "CANCELLATION", occurredAt: date("2026-01-01"), source: "OWNER" },
      { type: "RESUMPTION", occurredAt: date("2026-01-02"), source: "OWNER" },
      { type: "CHARGE", occurredAt: date("2026-01-03"), source: "PURCHASE" },
    ];

    expect(deriveObligationStatus(facts, monthlyCadence, date("2026-01-04"))).toBe("ACTIVE");
  });

  it("trial-conversion: is TRIALING before the first charge and ACTIVE after it", () => {
    const trial: ObligationFact = { type: "TRIAL_STARTED", occurredAt: date("2026-01-01") };
    expect(deriveObligationStatus([trial], monthlyCadence, date("2026-01-10"))).toBe("TRIALING");
    expect(deriveObligationStatus([trial, { type: "CHARGE", occurredAt: date("2026-01-15") }], monthlyCadence, date("2026-01-20"))).toBe("ACTIVE");
  });

  it("price-increase: remains ACTIVE while amount history gains an entry", () => {
    const observations: Observation[] = [
      ["2025-01-15", 1_599], ["2025-02-15", 1_599], ["2025-03-15", 1_599],
      ["2025-04-15", 1_799], ["2025-05-15", 1_799], ["2025-06-15", 1_799],
    ].map(([iso, amountMinor]) => ({ date: date(iso as string), amountMinor: amountMinor as number, currency: "CAD" }));
    const pattern = inferAmountPattern(observations);
    const facts: ObligationFact[] = observations.map(({ date: occurredAt }) => ({ type: "CHARGE", occurredAt }));
    facts.push({ type: "PRICE_CHANGE", occurredAt: date("2025-04-01"), amountMinor: 1_799 });

    expect(pattern.schedule).toHaveLength(2);
    expect(deriveObligationStatus(facts, monthlyCadence, date("2025-06-20"))).toBe("ACTIVE");
  });

  it("lapsed-vs-cancelled: silence is LAPSED, never CANCELLED", () => {
    expect(deriveObligationStatus([{ type: "CHARGE", occurredAt: date("2026-01-15") }], monthlyCadence, date("2026-04-01"))).toBe("LAPSED");
  });

  it("annual-stated-in-email: accepts two charges only when an email explicitly states cadence", () => {
    const facts = extractEmailSignals([{
      createdAt: date("2026-08-29"),
      subject: "Your domain renews annually",
      textBody: "Your subscription renews annually on August 29, 2027.",
    }]);
    expect(facts).toContainEqual(expect.objectContaining({ type: "EXPLICIT_CADENCE", cadence: "ANNUAL" }));
    expect(hasSufficientRecurringEvidence(2, facts)).toBe(true);
    expect(hasSufficientRecurringEvidence(2, [])).toBe(false);
  });

  it("email-stated: admits zero charges only with cadence plus a stated amount or billing date", () => {
    const occurredAt = date("2026-08-29");
    const cadence: ObligationFact = { type: "EXPLICIT_CADENCE", occurredAt, cadence: "MONTHLY" };
    const statedAmount: ObligationFact = { type: "PRICE_CHANGE", occurredAt, amountMinor: 1_499 };
    const nextBillingDate: ObligationFact = {
      type: "NEXT_BILLING_DATE",
      occurredAt,
      billingAt: date("2026-09-15"),
    };

    expect(hasSufficientRecurringEvidence(0, [cadence, statedAmount])).toBe(true);
    expect(hasSufficientRecurringEvidence(0, [cadence, nextBillingDate])).toBe(true);
    expect(hasSufficientRecurringEvidence(0, [cadence])).toBe(false);
    expect(hasSufficientRecurringEvidence(0, [statedAmount, nextBillingDate])).toBe(false);
    expect(hasSufficientRecurringEvidence(1, [cadence, statedAmount, nextBillingDate])).toBe(false);
  });

  it("email-stated: confidence remains structurally capped at 0.45 without charge reasons", () => {
    const occurredAt = date("2026-08-29");
    const cluster: CandidateCluster = {
      userId: "user-1",
      canonicalMerchantId: "fictional-stream.example",
      currency: "CAD",
      discriminator: null,
      purchases: [],
      cadence: { cadence: monthlyCadence, coverage: 0, mad: 0 },
      amountPattern: { pattern: "UNKNOWN", schedule: [{ amountMinor: 1_499, from: "2026-08-29" }] },
    };
    const result = scoreRecurringConfidence(cluster, [
      { type: "EXPLICIT_CADENCE", occurredAt, cadence: "MONTHLY" },
      { type: "EXPLICIT_RECURRING", occurredAt },
      { type: "PRICE_CHANGE", occurredAt, amountMinor: 1_499 },
    ], { knownMerchant: true });

    expect(result.score).toBeCloseTo(0.45, 10);
    expect(result.score).toBeLessThanOrEqual(0.45);
    expect(result.reasons.map(({ code }) => code).sort()).toEqual([
      "EXPLICIT_CADENCE",
      "EXPLICIT_RECURRING",
      "KNOWN_MERCHANT",
    ]);
  });

  it("stores readable confidence reasons rather than serialized diagnostics", () => {
    const cluster = monthlyCluster(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15"]);
    const result = scoreRecurringConfidence(cluster, [], { knownMerchant: true, merchantName: "Spotify" });

    expect(result.reasons.find(({ code }) => code === "REGULAR_OCCURRENCES")?.detail).toBe("5 Spotify charges, about 30 days apart.");
    expect(result.reasons.every(({ detail }) => !detail.includes("{"))).toBe(true);
  });
});

describe("email signals", () => {
  it("extracts cancellation, trial, price, and next-billing facts without treating marketing as evidence", () => {
    const facts = extractEmailSignals([
      { createdAt: date("2026-01-01"), subject: "Your subscription has been cancelled effective February 1, 2026" },
      { createdAt: date("2026-01-02"), subject: "Your trial starts today" },
      { createdAt: date("2026-01-03"), subject: "Your plan price will increase to $17.99 on February 1, 2026" },
      { createdAt: date("2026-01-04"), subject: "Your subscription will be charged on February 4, 2026" },
      { createdAt: date("2026-01-05"), subject: "Monthly newsletter: save on your next plan" },
    ]);

    expect(facts.map(({ type }) => type)).toEqual([
      "CANCELLATION", "TRIAL_STARTED", "PRICE_CHANGE", "NEXT_BILLING_DATE",
    ]);
    expect(facts[2]).toMatchObject({ type: "PRICE_CHANGE", amountMinor: 1_799 });
  });
});
