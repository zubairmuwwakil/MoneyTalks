import { describe, expect, it } from "vitest";
import { analyzeStatement, categorize } from "./analyzer";
import { FIXTURE_CARDS } from "./fixtures";
import type { CardDef } from "./types";

const [alpha, beta] = FIXTURE_CARDS;

describe("categorize", () => {
  it("uses merchant facts first", () => {
    expect(categorize("NO FRILLS #123")).toBe("groceries");
    expect(categorize("TIM HORTONS 456")).toBe("dining");
  });

  it("falls back to keywords, then everything_else", () => {
    expect(categorize("SUPERMARKET PLAZA")).toBe("groceries");
    expect(categorize("PIZZA PALACE")).toBe("dining");
    expect(categorize("MYSTERY VENDOR")).toBe("everything_else");
  });
});

describe("analyzeStatement", () => {
  const spend = [
    { date: "2026-08-01", amountMinor: 100_000, description: "SUPERMARKET PLAZA" }, // groceries
    { date: "2026-08-02", amountMinor: 50_000, description: "PIZZA PALACE" }, // dining
    { date: "2026-08-03", amountMinor: -10_000, description: "REFUND" }, // excluded
    { date: "2026-08-04", amountMinor: 20_000, description: "MYSTERY VENDOR" }, // everything_else
  ];

  it("computes earned vs optimal on the Beta card", () => {
    const report = analyzeStatement(spend, beta, FIXTURE_CARDS, "2026-08-15");
    expect(report.totalSpendMinor).toBe(170_000);
    // Beta earns: groceries 3% of 1000 = 3000; dining base 1.5% of 500 = 750; misc 1.5% of 200 = 300 → 4050
    expect(report.earnedMinor).toBe(4_050);
    // Optimal: groceries Alpha 4.8% = 4800; dining Alpha 6% = 3000; misc Gamma 2% = 400 → 8200
    expect(report.optimalMinor).toBe(8_200);
    expect(report.missedMinor).toBe(4_150);
    const groceries = report.byCategory.find((c) => c.category === "groceries");
    expect(groceries?.bestCardNickname).toBe("Fixture Alpha Amex");
  });

  it("reports zero missed when the used card is optimal everywhere", () => {
    const diningOnly = [{ date: "2026-08-02", amountMinor: 50_000, description: "PIZZA PALACE" }];
    const report = analyzeStatement(diningOnly, alpha, FIXTURE_CARDS, "2026-08-15");
    expect(report.missedMinor).toBe(0);
  });

  // Ruling B: the "best" alternative must be computed in the merchant's
  // acceptance context, so a network-restricted merchant can never be
  // answered with a card it refuses — even when that card's rate is
  // higher. Costco in-store is Mastercard-only in the merchant facts.
  it("never recommends a network-restricted card the merchant refuses", () => {
    const testAmex: CardDef = {
      id: "test-amex",
      nickname: "Test Amex High Rate",
      network: "AMEX",
      annualFeeMinor: 0,
      rewards: {
        pointValueCents: 1,
        fxFeePct: 0,
        baseMultiplier: 1,
        categoryRates: [{ category: "warehouse", multiplier: 10 }], // 10% — beats the Mastercard below
        credits: [],
      },
    };
    const testMastercard: CardDef = {
      id: "test-mc",
      nickname: "Test Mastercard Low Rate",
      network: "MASTERCARD",
      annualFeeMinor: 0,
      rewards: {
        pointValueCents: 1,
        fxFeePct: 0,
        baseMultiplier: 1,
        categoryRates: [{ category: "warehouse", multiplier: 2 }], // 2% — lower, but Costco in-store accepts it
        credits: [],
      },
    };
    const testVisaUsed: CardDef = {
      id: "test-visa",
      nickname: "Test Visa Used",
      network: "VISA",
      annualFeeMinor: 0,
      rewards: { pointValueCents: 1, fxFeePct: 0, baseMultiplier: 1, categoryRates: [], credits: [] },
    };

    const costcoSpend = [{ date: "2026-08-05", amountMinor: 10_000, description: "COSTCO WHOLESALE #221" }];
    const report = analyzeStatement(
      costcoSpend,
      testVisaUsed,
      [testAmex, testMastercard, testVisaUsed],
      "2026-08-15",
    );

    const warehouse = report.byCategory.find((c) => c.category === "warehouse");
    // The Amex would score 10% (highest) but is filtered out — Costco
    // in-store is Mastercard-only — so the Mastercard (2%) wins instead.
    expect(warehouse?.bestCardNickname).toBe("Test Mastercard Low Rate");
    expect(warehouse?.optimalMinor).toBe(200); // 10_000 * 2% = 200, not 10_000 * 10% = 1000
  });
});
