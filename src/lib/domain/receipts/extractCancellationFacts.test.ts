import { describe, expect, it } from "vitest";
import { extractCancellationFacts } from "./extractCancellationFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractCancellationFacts", () => {
  it("extracts cancellation fact and parses effective date", () => {
    const facts = extractCancellationFacts({
      subject: "Your subscription has been cancelled",
      textBody: "Thanks for trying us. Your subscription has been cancelled and ends on 2026-09-15.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "CANCELLATION",
      extractorId: "cancellation",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
      effectiveAt: new Date("2026-09-15T12:00:00.000Z"),
    });
    expect(facts[0].evidenceSnippet).toContain("has been cancelled");
  });

  it("extracts cancellation without explicit date", () => {
    const facts = extractCancellationFacts({
      subject: "Cancellation confirmed",
      textBody: "Your cancellation is complete. Your membership is now inactive.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "CANCELLATION",
      extractorId: "cancellation",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
      effectiveAt: undefined,
    });
  });

  it("ignores non-obligation email", () => {
    const facts = extractCancellationFacts({
      subject: "Appointment cancelled",
      textBody: "Your dentist appointment was cancelled.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });
});
