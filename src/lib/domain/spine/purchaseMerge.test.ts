import { describe, it, expect } from "vitest";
import { merchantsCompatible, scoreCandidate } from "./purchaseMerge";

const base = {
  userId: "user-1",
  amountMinor: 642,
  observedAt: new Date("2026-08-16T22:25:31Z"),
  merchantCandidates: ["Starbucks"],
  incomingSource: "WALLET" as const,
};

function candidate(overrides: Partial<{ merchant: string; totalCents: number | null; purchasedAt: Date }> = {}) {
  return {
    merchant: "Starbucks",
    totalCents: 642,
    purchasedAt: new Date("2026-08-16T22:00:00Z"),
    ...overrides,
  };
}

describe("merchantsCompatible", () => {
  it("matches case- and punctuation-insensitively", () => {
    expect(merchantsCompatible("SQ *CAFE BLEU", "sq cafe bleu")).toBe(true);
  });
  it("matches by containment either way", () => {
    expect(merchantsCompatible("STARBUCKS #1234", "Starbucks")).toBe(true);
    expect(merchantsCompatible("Amazon", "AMAZON.CA*ORDER")).toBe(true);
  });
  it("rejects unrelated merchants and empty strings", () => {
    expect(merchantsCompatible("Starbucks", "Tim Hortons")).toBe(false);
    expect(merchantsCompatible("", "Starbucks")).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("is exact when amount, window, and merchant all agree", () => {
    expect(scoreCandidate(candidate(), base)).toBe("exact");
  });

  it("is only possible when merchant disagrees — never silently mergeable", () => {
    expect(scoreCandidate(candidate({ merchant: "SP MYSTERYSHOP" }), base)).toBe("possible");
  });

  it("rejects a different amount outright, even one cent off", () => {
    expect(scoreCandidate(candidate({ totalCents: 643 }), base)).toBeNull();
  });

  it("rejects null amounts and matches outside the 72h window", () => {
    expect(scoreCandidate(candidate({ totalCents: null }), base)).toBeNull();
    expect(scoreCandidate(candidate({ purchasedAt: new Date("2026-08-12T22:00:00Z") }), base)).toBeNull();
  });
});
