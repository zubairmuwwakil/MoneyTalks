import { describe, expect, it } from "vitest";
import { extractTrialStartedFacts } from "./extractTrialStartedFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractTrialStartedFacts", () => {
  it("extracts trial started notification with effective date", () => {
    const facts = extractTrialStartedFacts({
      subject: "Welcome to your free trial",
      textBody: "Your trial starts on 2026-09-01. Enjoy full access to your plan.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "TRIAL_STARTED",
      extractorId: "trial-started",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
      effectiveAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    expect(facts[0].evidenceSnippet).toContain("trial starts on");
  });

  it("extracts trial has begun without explicit date", () => {
    const facts = extractTrialStartedFacts({
      subject: "Your trial has begun",
      textBody: "Your trial has started for your subscription.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "TRIAL_STARTED",
      extractorId: "trial-started",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
    });
  });

  it("ignores non-obligation email", () => {
    const facts = extractTrialStartedFacts({
      subject: "Team project starts today",
      textBody: "Our sprint starts this morning.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });
});
