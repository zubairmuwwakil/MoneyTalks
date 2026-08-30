import { describe, expect, it } from "vitest";
import { extractCadenceFacts } from "./extractCadenceFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractCadenceFacts", () => {
  it("extracts explicit monthly cadence with operational billing context", () => {
    const facts = extractCadenceFacts({
      subject: "Subscription Renewal Notice",
      textBody: "Your plan renews monthly on the 15th. Thank you for your payment.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "EXPLICIT_CADENCE",
      cadence: "MONTHLY",
      extractorId: "cadence",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
    });
    expect(facts[0].evidenceSnippet).toContain("renews monthly");
  });

  it("extracts annual cadence from subject", () => {
    const facts = extractCadenceFacts({
      subject: "Your domain renews annually",
      textBody: "Your subscription renews annually on August 29, 2027.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "EXPLICIT_CADENCE",
      cadence: "ANNUAL",
      extractorId: "cadence",
      extractorVersion: 1,
      factKey: "",
    });
  });

  it("ignores cadence mentions without operational billing keywords (e.g. marketing newsletters)", () => {
    const facts = extractCadenceFacts({
      subject: "Weekly digest",
      textBody: "Here is your weekly digest of top stories.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });

  it("ignores cadence mentions without obligation context", () => {
    const facts = extractCadenceFacts({
      subject: "Weekly update",
      textBody: "Our team met weekly for syncs.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });
});
