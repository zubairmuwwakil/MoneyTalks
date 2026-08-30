import { describe, expect, test } from "vitest";

import { SNIPPET_MAX_CHARS, extractEmailObligationFacts } from "./emailObligationFacts";

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
});
