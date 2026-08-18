import { describe, it, expect, vi } from "vitest";
import { findMatchingPurchase, merchantsCompatible, scoreCandidate } from "./purchaseMerge";

const base = {
  userId: "user-1",
  amountMinor: 642,
  observedAt: new Date("2026-08-16T22:25:31Z"),
  merchantCandidates: ["Starbucks"],
  incomingSource: "WALLET" as const,
};

function candidate(overrides: Partial<{ merchant: string; totalCents: number | null; currency: string | null; purchasedAt: Date }> = {}) {
  return {
    id: "purchase-1",
    merchant: "Starbucks",
    totalCents: 642,
    currency: "CAD",
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

describe("findMatchingPurchase currency compatibility", () => {
  it("does not rewrite an unknown incoming currency to CAD in the query", async () => {
    const findMany = vi.fn(async (_args: unknown) => [candidate()]);

    await findMatchingPurchase({ purchase: { findMany } } as never, { ...base, currency: null });

    const query = findMany.mock.calls[0]?.[0] as { where: { currency?: unknown } } | undefined;
    expect(query?.where.currency).toBeUndefined();
  });

  it("rejects contradictory known currencies even if the database returns the row", async () => {
    const findMany = vi.fn(async () => [candidate({ currency: "CAD" })]);

    const result = await findMatchingPurchase({ purchase: { findMany } } as never, {
      ...base,
      currency: "USD",
    });

    expect(result).toBeNull();
  });

  it("can merge an unknown observation into a matching known-currency purchase", async () => {
    const known = candidate({ currency: "CAD" });
    const findMany = vi.fn(async () => [known]);

    const result = await findMatchingPurchase({ purchase: { findMany } } as never, {
      ...base,
      currency: null,
    });

    expect(result).toEqual({ purchase: known, confidence: "exact" });
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
