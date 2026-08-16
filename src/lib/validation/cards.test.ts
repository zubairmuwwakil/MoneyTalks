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
