import { describe, expect, it } from "vitest";
import { extractRecurringFacts } from "./extractRecurringFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractRecurringFacts", () => {
  it("extracts auto-renewal language as an explicit recurring fact", () => {
    const facts = extractRecurringFacts({
      subject: "Membership Confirmation",
      textBody: "Your subscription renews automatically unless cancelled.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "EXPLICIT_RECURRING",
      extractorId: "recurring",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
    });
    expect(facts[0].evidenceSnippet).toContain("renews automatically");
  });

  it("extracts recurring payment wording", () => {
    const facts = extractRecurringFacts({
      subject: "Recurring payment scheduled",
      textBody: "This is a recurring billing agreement for your plan.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe("EXPLICIT_RECURRING");
  });

  it("ignores non-obligation email text", () => {
    const facts = extractRecurringFacts({
      subject: "Recurring meeting",
      textBody: "Let's set up a recurring meeting for our project.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });
});
