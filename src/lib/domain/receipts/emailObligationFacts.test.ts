import { describe, expect, test } from "vitest";

import {
  ALL_FACT_EXTRACTORS,
  SNIPPET_MAX_CHARS,
  deriveSubscriptionDetectedItemType,
  evaluateEmailObligationFactExtraction,
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

  test("only treats subscription or membership lifecycle language as cancellation", () => {
    const genuine = [
      {
        subject: "Subscription update",
        textBody: "Your subscription has been cancelled.",
      },
      {
        subject: "Membership update",
        textBody: "Membership cancelled effective today.",
      },
      {
        subject: "Cancellation confirmed",
        textBody: "Cancellation confirmed. Your subscription remains available through September.",
      },
      {
        subject: "Subscription update",
        textBody: "Your subscription will end on 2026-09-15.",
      },
    ];
    const commerceNoise = [
      {
        subject: "Reservation confirmed",
        textBody: "Your booking includes free cancellation until Friday. Payment is due on arrival.",
      },
      {
        subject: "Travel plan details",
        textBody: "Flexible cancellation is included with this payment plan.",
      },
      {
        subject: "Plan features",
        textBody: "You can cancel anytime from your monthly plan settings.",
      },
      {
        subject: "Plan help",
        textBody: "To cancel your plan, visit the billing settings page.",
      },
      {
        subject: "Order cancelled",
        textBody: "Your order has been cancelled. Your payment will be refunded.",
      },
    ];

    for (const input of genuine) {
      expect(extractEmailObligationFacts({ ...input, occurredAt }))
        .toEqual(expect.arrayContaining([expect.objectContaining({ type: "CANCELLATION" })]));
    }
    for (const input of commerceNoise) {
      expect(extractEmailObligationFacts({ ...input, occurredAt }))
        .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "CANCELLATION" })]));
    }
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

  test("does not turn an order price update into a subscription price change", () => {
    const facts = extractEmailObligationFacts({
      subject: "Order update",
      textBody: "Your order price has changed. Your payment method has not been charged.",
      occurredAt,
    });

    expect(facts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "PRICE_CHANGE" })]),
    );
  });

  test("registers all seven pure extractors", () => {
    expect(ALL_FACT_EXTRACTORS).toHaveLength(7);
  });

  test("does not classify emails outside obligation context as near misses", () => {
    const evaluation = evaluateEmailObligationFactExtraction({
      subject: "Your weekly newsletter",
      textBody: "A new post is available.",
      occurredAt,
    });

    expect(evaluation).toMatchObject({ facts: [], nearMissReasons: null });
  });

  test("records a closed reason for cadence without an operational billing statement", () => {
    const evaluation = evaluateEmailObligationFactExtraction({
      subject: "Your monthly membership update",
      textBody: "Your membership includes monthly articles and videos.",
      occurredAt,
    });

    expect(evaluation).toMatchObject({
      facts: [],
      nearMissReasons: ["CADENCE_WITHOUT_BILLING_OPERATION"],
    });
  });

  test("records an unparseable stated next billing date", () => {
    const evaluation = evaluateEmailObligationFactExtraction({
      subject: "Subscription billing update",
      textBody: "Your next billing date is shortly after your current period ends.",
      occurredAt,
    });

    expect(evaluation).toMatchObject({
      facts: [],
      nearMissReasons: ["NEXT_BILLING_DATE_UNPARSEABLE"],
    });
  });

  test("uses the generic closed reason when no supported fact language is present", () => {
    const evaluation = evaluateEmailObligationFactExtraction({
      subject: "Your subscription account update",
      textBody: "Please review your settings.",
      occurredAt,
    });

    expect(evaluation).toMatchObject({
      facts: [],
      nearMissReasons: ["NO_SUPPORTED_FACT_LANGUAGE"],
    });
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
