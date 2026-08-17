import { describe, it, expect } from "vitest";
import { statementLineHash, parseCandidateId } from "./statementLines";

describe("statementLineHash", () => {
  const base = { cardId: "card-1", date: "2026-08-16", description: "SQ *CAFE", amountMinor: 642 };

  it("is stable across whitespace and casing of the description", () => {
    expect(statementLineHash(base)).toBe(statementLineHash({ ...base, description: "  sq *cafe " }));
  });

  it("differs when any identity component differs", () => {
    expect(statementLineHash(base)).not.toBe(statementLineHash({ ...base, amountMinor: 643 }));
    expect(statementLineHash(base)).not.toBe(statementLineHash({ ...base, date: "2026-08-17" }));
    expect(statementLineHash(base)).not.toBe(statementLineHash({ ...base, cardId: "card-2" }));
  });
});

describe("parseCandidateId", () => {
  it("splits purchase and wallet candidate ids", () => {
    expect(parseCandidateId("purchase:abc")).toEqual({ purchaseId: "abc", walletEventId: null });
    expect(parseCandidateId("wallet:xyz")).toEqual({ purchaseId: null, walletEventId: "xyz" });
    expect(parseCandidateId(undefined)).toEqual({ purchaseId: null, walletEventId: null });
  });
});
