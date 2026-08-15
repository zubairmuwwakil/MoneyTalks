import { describe, expect, it } from "vitest";
import { FIXTURE_CARDS } from "./fixtures";
import { effectiveReturnPct, recommend, type PurchaseCtx } from "./picker";

const baseCtx: PurchaseCtx = {
  category: "everything_else",
  amexAccepted: true,
  foreign: false,
  networkRestriction: null,
  today: "2026-08-15",
};

const [alpha, beta, gamma] = FIXTURE_CARDS;

describe("effectiveReturnPct", () => {
  it("multiplies category rate by point value", () => {
    const result = effectiveReturnPct(alpha, { ...baseCtx, category: "dining" }, []);
    expect(result?.pct).toBeCloseTo(6);
    expect(result?.why).toContain("5x");
  });

  it("falls back to the base multiplier without a category rate", () => {
    expect(effectiveReturnPct(gamma, { ...baseCtx, category: "dining" }, [])?.pct).toBeCloseTo(2);
  });

  it("subtracts the FX fee on foreign purchases", () => {
    expect(effectiveReturnPct(beta, { ...baseCtx, foreign: true }, [])?.pct).toBeCloseTo(-1);
    expect(effectiveReturnPct(gamma, { ...baseCtx, foreign: true }, [])?.pct).toBeCloseTo(2);
  });

  it("excludes Amex where not accepted and non-matching networks under a restriction", () => {
    expect(effectiveReturnPct(alpha, { ...baseCtx, amexAccepted: false }, [])).toBeNull();
    expect(effectiveReturnPct(beta, { ...baseCtx, networkRestriction: "MASTERCARD" }, [])).toBeNull();
    expect(effectiveReturnPct(gamma, { ...baseCtx, networkRestriction: "MASTERCARD" }, [])).not.toBeNull();
  });

  it("demotes a capped-out category to the base rate", () => {
    const ctx: PurchaseCtx = { ...baseCtx, category: "groceries" };
    const full = effectiveReturnPct(alpha, ctx, []);
    expect(full?.pct).toBeCloseTo(4.8);
    const capped = effectiveReturnPct(alpha, ctx, [
      { cardId: "alpha", category: "groceries", periodKey: "2026-08", usedMinor: 150_000 },
    ]);
    expect(capped?.pct).toBeCloseTo(1.2);
    expect(capped?.why).toContain("cap");
  });

  it("ignores cap usage from other periods", () => {
    const ctx: PurchaseCtx = { ...baseCtx, category: "groceries" };
    const lastMonth = effectiveReturnPct(alpha, ctx, [
      { cardId: "alpha", category: "groceries", periodKey: "2026-07", usedMinor: 150_000 },
    ]);
    expect(lastMonth?.pct).toBeCloseTo(4.8);
  });
});

describe("recommend", () => {
  it("ranks best and runner-up for groceries with Amex accepted", () => {
    const { best, runnerUp } = recommend(FIXTURE_CARDS, { ...baseCtx, category: "groceries" }, []);
    expect(best?.cardId).toBe("alpha");
    expect(runnerUp?.cardId).toBe("beta");
  });

  it("re-ranks when Amex is not accepted", () => {
    const { best } = recommend(FIXTURE_CARDS, { ...baseCtx, category: "groceries", amexAccepted: false }, []);
    expect(best?.cardId).toBe("beta");
  });

  it("prefers the no-FX card on foreign purchases", () => {
    const { best } = recommend(FIXTURE_CARDS, { ...baseCtx, foreign: true }, []);
    expect(best?.cardId).toBe("gamma");
  });

  it("returns null best with no usable cards", () => {
    const { best } = recommend([alpha], { ...baseCtx, amexAccepted: false }, []);
    expect(best).toBeNull();
  });
});
