import { describe, it, expect } from "vitest";
import { applyUserDecision, purchaseIdsToReconcile, statementLineHash, parseCandidateId } from "./statementLines";

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

describe("applyUserDecision", () => {
  it("keeps a confirm or a reject when the same statement is uploaded again", () => {
    expect(applyUserDecision("matched-tolerant", "matched")).toBe("matched");
    expect(applyUserDecision("matched-tolerant", "rejected")).toBe("rejected");
  });

  it("protects a decision on a pre-auth hold the same way as one on a tip", () => {
    expect(applyUserDecision("matched-preauth", "matched")).toBe("matched");
    expect(applyUserDecision("matched-preauth", "rejected")).toBe("rejected");
    expect(applyUserDecision("matched-preauth", null)).toBe("matched-preauth");
  });

  it("takes the fresh result for a line no user has ruled on", () => {
    expect(applyUserDecision("matched-tolerant", "matched-tolerant")).toBe("matched-tolerant");
    expect(applyUserDecision("matched-tolerant", "unmatched")).toBe("matched-tolerant");
    expect(applyUserDecision("matched-tolerant", null)).toBe("matched-tolerant");
  });

  it("never lets a stale decision override a newly exact or excluded line", () => {
    expect(applyUserDecision("matched", "rejected")).toBe("matched");
    expect(applyUserDecision("ambiguous", "matched")).toBe("ambiguous");
    expect(applyUserDecision("excluded", "matched")).toBe("excluded");
  });
});

describe("purchaseIdsToReconcile", () => {
  it("promotes exact matches and refuses tolerant ones", () => {
    expect(
      purchaseIdsToReconcile([
        { status: "matched", purchaseId: "p-1" },
        { status: "matched-tolerant", purchaseId: "p-2" },
        { status: "ambiguous", purchaseId: "p-3" },
        { status: "rejected", purchaseId: "p-4" },
        { status: "unmatched", purchaseId: null },
      ]),
    ).toEqual(["p-1"]);
  });

  it("collapses two lines that resolved to the same purchase", () => {
    expect(
      purchaseIdsToReconcile([
        { status: "matched", purchaseId: "p-1" },
        { status: "matched", purchaseId: "p-1" },
      ]),
    ).toEqual(["p-1"]);
  });
});
