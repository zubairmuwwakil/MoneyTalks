import { describe, expect, it } from "vitest";
import { cardImportEntry, cardRewardsInput } from "./cards";

// The import format speaks DOLLARS; the engine's CardRewards speaks integer cents.
// They are deliberately different shapes, so this file builds its own dollar-shaped
// fixture rather than feeding the engine's storage fixture into the parser.
const REWARDS_IN_DOLLARS = {
  pointValueCents: 1.2,
  fxFeePct: 2.5,
  baseMultiplier: 1,
  categoryRates: [
    { category: "dining", multiplier: 5 },
    { category: "groceries", multiplier: 4, cap: 1500, capWindow: "MONTH" },
  ],
  credits: [{ id: "dine100", label: "$100 dining credit", value: 100, period: "YEAR" }],
};

describe("cardRewardsInput", () => {
  it("takes dollars and stores cents", () => {
    const parsed = cardRewardsInput.safeParse(REWARDS_IN_DOLLARS);
    expect(parsed).toMatchObject({
      success: true,
      data: {
        categoryRates: [
          { category: "dining", multiplier: 5 },
          { category: "groceries", multiplier: 4, capMinor: 150_000, capWindow: "MONTH" },
        ],
        credits: [{ id: "dine100", valueMinor: 10_000, period: "YEAR" }],
      },
    });
  });

  it("rejects unknown categories, negative values, and caps without windows", () => {
    expect(
      cardRewardsInput.safeParse({
        ...REWARDS_IN_DOLLARS,
        categoryRates: [{ category: "lottery", multiplier: 2 }],
      }).success,
    ).toBe(false);
    expect(cardRewardsInput.safeParse({ ...REWARDS_IN_DOLLARS, pointValueCents: -1 }).success).toBe(false);
    expect(
      cardRewardsInput.safeParse({
        ...REWARDS_IN_DOLLARS,
        categoryRates: [{ category: "dining", multiplier: 2, cap: 10 }],
      }).success,
    ).toBe(false);
  });

  it("rejects sub-cent precision rather than silently rounding a cap", () => {
    expect(
      cardRewardsInput.safeParse({
        ...REWARDS_IN_DOLLARS,
        categoryRates: [{ category: "dining", multiplier: 2, cap: "10.555", capWindow: "YEAR" }],
      }).success,
    ).toBe(false);
  });
});

describe("cardImportEntry", () => {
  it("accepts the string-valued numeric fields submitted by the card form", () => {
    const parsed = cardImportEntry.safeParse({
      nickname: "Browser form card",
      issuer: "Fixture Bank",
      network: "VISA",
      annualFee: "120.00",
      dueDay: "15",
      aprPct: "19.99",
      rewards: {
        pointValueCents: "1.5",
        fxFeePct: "2.5",
        baseMultiplier: "1",
        categoryRates: [{ category: "dining", multiplier: "3", cap: "500.00", capWindow: "MONTH" }],
        credits: [{ id: "fixture-credit", label: "Fixture credit", value: "10.00", period: "MONTH" }],
      },
    });

    expect(parsed).toMatchObject({
      success: true,
      data: {
        annualFeeMinor: 12_000,
        dueDay: 15,
        aprPct: 19.99,
        rewards: {
          pointValueCents: 1.5,
          categoryRates: [{ multiplier: 3, capMinor: 50_000 }],
          credits: [{ valueMinor: 1_000 }],
        },
      },
    });
  });

  it("accepts a full card entry and converts its dollar amounts", () => {
    const parsed = cardImportEntry.safeParse({
      nickname: "Fixture Alpha Amex",
      issuer: "Fixture Financial",
      network: "AMEX",
      annualFee: 150,
      limit: 10_000,
      dueDay: 15,
      rewards: REWARDS_IN_DOLLARS,
    });
    expect(parsed).toMatchObject({
      success: true,
      data: { annualFeeMinor: 15_000, limitMinor: 1_000_000 },
    });
  });

  it("defaults a missing annual fee to zero", () => {
    const parsed = cardImportEntry.safeParse({
      nickname: "No Fee Card",
      issuer: "Fixture Bank",
      network: "VISA",
      rewards: REWARDS_IN_DOLLARS,
    });
    expect(parsed).toMatchObject({ success: true, data: { annualFeeMinor: 0 } });
  });

  it("defaults omitted recurring credits to an empty list", () => {
    const rewardsWithoutCredits = {
      pointValueCents: REWARDS_IN_DOLLARS.pointValueCents,
      fxFeePct: REWARDS_IN_DOLLARS.fxFeePct,
      baseMultiplier: REWARDS_IN_DOLLARS.baseMultiplier,
      categoryRates: REWARDS_IN_DOLLARS.categoryRates,
    };
    const parsed = cardImportEntry.safeParse({
      nickname: "No credits card",
      issuer: "Fixture Bank",
      network: "VISA",
      rewards: rewardsWithoutCredits,
    });

    expect(parsed).toMatchObject({ success: true, data: { rewards: { credits: [] } } });
  });

  it("rejects a bad network and out-of-range due days", () => {
    const good = {
      nickname: "x",
      issuer: "y",
      network: "AMEX",
      rewards: REWARDS_IN_DOLLARS,
    };
    expect(cardImportEntry.safeParse({ ...good, network: "DINERS" }).success).toBe(false);
    expect(cardImportEntry.safeParse({ ...good, dueDay: 31 }).success).toBe(false);
  });
});
