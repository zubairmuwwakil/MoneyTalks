import { describe, expect, it } from "vitest";

import { ownerFactToObligationFact, ownerFactValidation } from "./ownerFacts";

const now = new Date("2026-08-30T12:00:00.000Z");

describe("owner facts", () => {
  it("requires typed payloads instead of interpreting partial assertions", () => {
    expect(() => ownerFactValidation.assertFactPayload({ type: "CHARGE", occurredAt: now })).toThrow("amountMinor and currency");
    expect(() => ownerFactValidation.assertFactPayload({ type: "EXPLICIT_CADENCE", occurredAt: now })).toThrow("requires a supported cadence");
    expect(() => ownerFactValidation.assertFactPayload({ type: "NEXT_BILLING_DATE", occurredAt: now })).toThrow("requires billingAt");
  });

  it("marks owner facts as owner evidence for lifecycle precedence", () => {
    const fact = ownerFactToObligationFact({
      type: "CANCELLATION",
      occurredAt: now,
      effectiveAt: null,
      billingAt: null,
      amountMinor: null,
      cadence: null,
    });
    expect(fact).toMatchObject({ type: "CANCELLATION", source: "OWNER" });
  });
});
