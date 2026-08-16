import { describe, expect, it } from "vitest";
import { creditsRealizedMinor, effectiveAnnualFeeMinor } from "./fees";
import type { CardDef } from "./types";

const today = "2026-08-15";

const alpha: CardDef = {
  id: "alpha",
  nickname: "Fixture Alpha Amex",
  network: "AMEX",
  annualFeeMinor: 15_000,
  rewards: {
    pointValueCents: 1.2,
    fxFeePct: 2.5,
    baseMultiplier: 1,
    categoryRates: [{ category: "dining", multiplier: 5 }],
    credits: [{ id: "dine100", label: "$100 dining credit", valueMinor: 10_000, period: "YEAR" }],
  },
};

describe("effectiveAnnualFeeMinor", () => {
  it("returns the published fee when there are no waiver conditions", () => {
    expect(effectiveAnnualFeeMinor(alpha)).toBe(15_000);
  });

  it("subtracts the reduction from an active fee-waiver condition", () => {
    const waived: CardDef = {
      ...alpha,
      rewards: {
        ...alpha.rewards,
        conditions: [{ id: "waiver", label: "Employer annual-fee waiver", enabled: true, annualFeeReductionMinor: 15_000 }],
      },
    };
    expect(effectiveAnnualFeeMinor(waived)).toBe(0);
  });

  it("ignores a waiver condition that is not enabled", () => {
    const inactive: CardDef = {
      ...alpha,
      rewards: {
        ...alpha.rewards,
        conditions: [{ id: "waiver", label: "Employer annual-fee waiver", enabled: false, annualFeeReductionMinor: 15_000 }],
      },
    };
    expect(effectiveAnnualFeeMinor(inactive)).toBe(15_000);
  });

  it("floors at zero rather than going negative", () => {
    const overWaived: CardDef = {
      ...alpha,
      annualFeeMinor: 5_000,
      rewards: {
        ...alpha.rewards,
        conditions: [{ id: "waiver", label: "Big waiver", enabled: true, annualFeeReductionMinor: 15_000 }],
      },
    };
    expect(effectiveAnnualFeeMinor(overWaived)).toBe(0);
  });
});

describe("creditsRealizedMinor", () => {
  it("sums the value of credits redeemed in the current period", () => {
    const realized = creditsRealizedMinor(alpha.rewards.credits, [{ creditId: "dine100", periodKey: "2026" }], today);
    expect(realized).toBe(10_000);
  });

  it("ignores credits redeemed in a different period", () => {
    const realized = creditsRealizedMinor(alpha.rewards.credits, [{ creditId: "dine100", periodKey: "2025" }], today);
    expect(realized).toBe(0);
  });

  it("ignores redemptions for a credit id the card no longer has", () => {
    const realized = creditsRealizedMinor(alpha.rewards.credits, [{ creditId: "unknown", periodKey: "2026" }], today);
    expect(realized).toBe(0);
  });

  it("returns zero for a card with no credits", () => {
    expect(creditsRealizedMinor([], [], today)).toBe(0);
  });
});
