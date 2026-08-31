import { describe, expect, it, vi } from "vitest";

import { ownerFactToObligationFact, ownerFactValidation, updateOwnerObligation } from "./ownerFacts";

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

  it("rejects reusing an idempotency key for a different fact instead of mutating it", async () => {
    const existing = {
      id: "fact-1", type: "CANCELLATION", sourceKey: "request-1", occurredAt: now,
      effectiveAt: null, billingAt: null, amountMinor: null, currency: null,
      cadence: null, note: null, supersedesId: null,
    };
    const tx = {
      recurringObligation: { findFirst: vi.fn().mockResolvedValue({ id: "obligation-1" }), update: vi.fn() },
      recurringObligationOwnerFact: { findMany: vi.fn(), upsert: vi.fn().mockResolvedValue(existing) },
    };
    const db = { $transaction: vi.fn((operation) => operation(tx)) };

    await expect(updateOwnerObligation(db as never, {
      userId: "user-1",
      obligationId: "obligation-1",
      facts: [{ type: "RESUMPTION", occurredAt: now, sourceKey: "request-1" }],
    })).rejects.toThrow("sourceKey already identifies a different owner fact");
    expect(tx.recurringObligationOwnerFact.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });
});
