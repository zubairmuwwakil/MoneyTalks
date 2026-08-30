import { describe, expect, test } from "vitest";

import {
  ALL_FACT_EXTRACTORS,
  SNIPPET_MAX_CHARS,
  deriveSubscriptionDetectedItemType,
  extractEmailObligationFacts,
} from "./emailObligationFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractEmailObligationFacts", () => {
  test("keeps the sentence that produced a cancellation fact", () => {
    const facts = extractEmailObligationFacts({
      subject: "Your subscription has been cancelled",
      textBody: "Thanks for trying us. Your subscription has been cancelled and ends on 2026-09-15.",
      occurredAt,
    });

    const cancellation = facts.find((fact) => fact.type === "CANCELLATION");
    expect(cancellation).toBeDefined();
    expect(cancellation!.evidenceSnippet).toContain("has been cancelled");
    expect(cancellation!.effectiveAt).toEqual(new Date("2026-09-15T12:00:00.000Z"));
  });

  test("drops URLs from the snippet and bounds its length", () => {
    const filler = "Account activity notice. ".repeat(40);
    const facts = extractEmailObligationFacts({
      subject: "Subscription update",
      textBody: `${filler} Your trial has ended. Manage it at https://example.test/u/tok_abc123?uid=99 today.`,
      occurredAt,
    });

    const trial = facts.find((fact) => fact.type === "TRIAL_ENDED");
    expect(trial).toBeDefined();
    expect(trial!.evidenceSnippet).toContain("trial has ended");
    expect(trial!.evidenceSnippet).not.toContain("example.test");
    expect(trial!.evidenceSnippet).not.toContain("tok_abc123");
    expect(trial!.evidenceSnippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
  });

  test("unions multiple facts from a single email stating cadence, price change, and next billing date", () => {
    const facts = extractEmailObligationFacts({
      subject: "Important update regarding your monthly subscription",
      textBody: "Your monthly plan price will increase to $24.99 starting on 2026-10-01. Your next billing date is 2026-10-01.",
      occurredAt,
    });

    const types = facts.map((f) => f.type);
    expect(types).toContain("EXPLICIT_CADENCE");
    expect(types).toContain("PRICE_CHANGE");
    expect(types).toContain("NEXT_BILLING_DATE");

    const cadenceFact = facts.find((f) => f.type === "EXPLICIT_CADENCE");
    expect(cadenceFact).toMatchObject({
      extractorId: "cadence",
      cadence: "MONTHLY",
    });

    const priceFact = facts.find((f) => f.type === "PRICE_CHANGE");
    expect(priceFact).toMatchObject({
      extractorId: "price-change",
      amountMinor: 2499,
      effectiveAt: new Date("2026-10-01T12:00:00.000Z"),
    });

    const nextBillingFact = facts.find((f) => f.type === "NEXT_BILLING_DATE");
    expect(nextBillingFact).toMatchObject({
      extractorId: "next-billing",
      billingAt: new Date("2026-10-01T12:00:00.000Z"),
    });
  });

  test("registers all seven pure extractors", () => {
    expect(ALL_FACT_EXTRACTORS).toHaveLength(7);
  });
});

describe("deriveSubscriptionDetectedItemType", () => {
  test("returns TRIAL for TRIAL_STARTED or TRIAL_ENDED facts", () => {
    expect(deriveSubscriptionDetectedItemType([{ type: "TRIAL_STARTED" }])).toBe("TRIAL");
    expect(deriveSubscriptionDetectedItemType([{ type: "TRIAL_ENDED" }])).toBe("TRIAL");
  });

  test("returns RENEWAL for EXPLICIT_CADENCE, EXPLICIT_RECURRING, or NEXT_BILLING_DATE facts", () => {
    expect(deriveSubscriptionDetectedItemType([{ type: "EXPLICIT_CADENCE" }])).toBe("RENEWAL");
    expect(deriveSubscriptionDetectedItemType([{ type: "EXPLICIT_RECURRING" }])).toBe("RENEWAL");
    expect(deriveSubscriptionDetectedItemType([{ type: "NEXT_BILLING_DATE" }])).toBe("RENEWAL");
  });

  test("prioritizes TRIAL when both trial and renewal facts are present", () => {
    expect(
      deriveSubscriptionDetectedItemType([
        { type: "EXPLICIT_CADENCE" },
        { type: "TRIAL_STARTED" },
        { type: "NEXT_BILLING_DATE" },
      ]),
    ).toBe("TRIAL");
  });

  test("returns null when no trial or renewal facts are present", () => {
    expect(deriveSubscriptionDetectedItemType([])).toBeNull();
    expect(deriveSubscriptionDetectedItemType([{ type: "PRICE_CHANGE" }])).toBeNull();
    expect(deriveSubscriptionDetectedItemType([{ type: "CANCELLATION" }])).toBeNull();
  });
});

