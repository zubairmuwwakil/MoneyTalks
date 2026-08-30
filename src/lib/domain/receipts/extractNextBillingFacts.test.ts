import { describe, expect, it } from "vitest";
import { extractNextBillingFacts } from "./extractNextBillingFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractNextBillingFacts", () => {
  it("extracts next billing date from notice", () => {
    const facts = extractNextBillingFacts({
      subject: "Upcoming charge notice",
      textBody: "Your subscription next billing date is 2026-09-15 for your monthly plan.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "NEXT_BILLING_DATE",
      extractorId: "next-billing",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
      billingAt: new Date("2026-09-15T12:00:00.000Z"),
    });
    expect(facts[0].evidenceSnippet).toContain("next billing date is");
  });

  it("extracts 'will be billed' date", () => {
    const facts = extractNextBillingFacts({
      subject: "Billing statement",
      textBody: "You will be billed on October 1, 2026 for your membership renewal.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "NEXT_BILLING_DATE",
      extractorId: "next-billing",
      extractorVersion: 1,
      billingAt: new Date("2026-10-01T12:00:00.000Z"),
    });
  });

  it("returns empty array if next billing language is present but no date is specified", () => {
    const facts = extractNextBillingFacts({
      subject: "Billing reminder",
      textBody: "Your subscription will be billed soon.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });

  it("ignores non-obligation email", () => {
    const facts = extractNextBillingFacts({
      subject: "Conference schedule",
      textBody: "Next session will be held tomorrow.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });
});
