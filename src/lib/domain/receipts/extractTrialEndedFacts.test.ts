import { describe, expect, it } from "vitest";
import { extractTrialEndedFacts } from "./extractTrialEndedFacts";

const occurredAt = new Date("2026-08-30T12:00:00.000Z");

describe("extractTrialEndedFacts", () => {
  it("extracts trial ended notification with effective expiration date", () => {
    const facts = extractTrialEndedFacts({
      subject: "Your trial is ending soon",
      textBody: "Your free trial expires on September 15, 2026. Keep your subscription active.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "TRIAL_ENDED",
      extractorId: "trial-ended",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
      effectiveAt: new Date("2026-09-15T12:00:00.000Z"),
    });
    expect(facts[0].evidenceSnippet).toContain("trial expires on");
  });

  it("extracts trial has ended without date", () => {
    const facts = extractTrialEndedFacts({
      subject: "Subscription update",
      textBody: "Your trial has ended. Subscribe today to maintain access to your plan.",
      occurredAt,
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: "TRIAL_ENDED",
      extractorId: "trial-ended",
      extractorVersion: 1,
      factKey: "",
      occurredAt,
    });
  });

  it("ignores non-obligation email", () => {
    const facts = extractTrialEndedFacts({
      subject: "Project deadline update",
      textBody: "The phase 1 deadline has passed.",
      occurredAt,
    });

    expect(facts).toEqual([]);
  });
});
