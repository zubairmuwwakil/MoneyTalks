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

  it("shares a cap across the categories assigned to a cap group", () => {
    const sharedCapCard = {
      ...alpha,
      rewards: {
        ...alpha.rewards,
        capGroups: [
          { id: "food", label: "Food", capMinor: 100_000, capWindow: "MONTH" },
        ],
        categoryRates: [
          { category: "groceries", multiplier: 4, capGroupId: "food" },
          { category: "dining", multiplier: 4, capGroupId: "food" },
        ],
      },
    } as unknown as typeof alpha;

    const result = effectiveReturnPct(sharedCapCard, { ...baseCtx, category: "groceries" }, [
      { cardId: "alpha", category: "dining", periodKey: "2026-08", usedMinor: 100_000 },
    ]);

    expect(result?.pct).toBeCloseTo(1.2);
    expect(result?.why).toContain("Food cap reached");
  });

  it("uses an eligible merchant-specific bonus and ignores it when its condition is off", () => {
    const merchantBonusCard = {
      ...alpha,
      rewards: {
        ...alpha.rewards,
        baseMultiplier: 1,
        merchantRates: [
          {
            id: "triangle",
            merchant: "Canadian Tire, Sport Chek",
            multiplier: 4,
            requiresConditionId: "triangle-account",
          },
        ],
        conditions: [{ id: "triangle-account", label: "Triangle account", enabled: true }],
      },
    } as unknown as typeof alpha;
    const ctx = {
      ...baseCtx,
      merchantName: "Sport Chek",
    } as unknown as PurchaseCtx;

    expect(effectiveReturnPct(merchantBonusCard, ctx, [])?.pct).toBeCloseTo(4.8);

    merchantBonusCard.rewards.conditions![0].enabled = false;
    expect(effectiveReturnPct(merchantBonusCard, ctx, [])?.pct).toBeCloseTo(1.2);
  });

  it("applies an active all-spend rate until its shared spend cap is reached", () => {
    const conditionalBaseCard = {
      ...alpha,
      rewards: {
        ...alpha.rewards,
        baseMultiplier: 0,
        conditions: [{ id: "pro", label: "Pro plan", enabled: true }],
        baseRateOverrides: [
          {
            id: "pro-rate",
            label: "Pro plan rewards",
            multiplier: 3,
            requiresConditionId: "pro",
            capMinor: 250_000,
            capWindow: "MONTH",
          },
        ],
        categoryRates: [{ category: "dining", multiplier: 5 }],
      },
    } as unknown as typeof alpha;

    expect(effectiveReturnPct(conditionalBaseCard, { ...baseCtx, category: "groceries" }, [])?.pct).toBeCloseTo(3.6);
    expect(effectiveReturnPct(conditionalBaseCard, { ...baseCtx, category: "dining" }, [])?.pct).toBeCloseTo(6);
    const capped = effectiveReturnPct(conditionalBaseCard, { ...baseCtx, category: "groceries" }, [
      { cardId: "alpha", category: "everything_else", periodKey: "2026-08", usedMinor: 250_000 },
    ]);
    expect(capped?.pct).toBeCloseTo(0);
    expect(capped?.why).toContain("Pro plan rewards cap reached");
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
