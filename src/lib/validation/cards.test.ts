import { describe, expect, it } from "vitest";
import { FIXTURE_CARDS } from "@/engine/cards/fixtures";
import { cardImportEntry, cardRewardsInput } from "./cards";

describe("cardRewardsInput", () => {
  it("accepts every fixture card's rewards", () => {
    for (const card of FIXTURE_CARDS) {
      expect(cardRewardsInput.safeParse(card.rewards).success).toBe(true);
    }
  });

  it("rejects unknown categories, negative values, and caps without windows", () => {
    const base = FIXTURE_CARDS[0].rewards;
    expect(
      cardRewardsInput.safeParse({
        ...base,
        categoryRates: [{ category: "lottery", multiplier: 2 }],
      }).success,
    ).toBe(false);
    expect(cardRewardsInput.safeParse({ ...base, pointValueCents: -1 }).success).toBe(false);
    expect(
      cardRewardsInput.safeParse({
        ...base,
        categoryRates: [{ category: "dining", multiplier: 2, capMinor: 1000 }],
      }).success,
    ).toBe(false);
  });
});

describe("cardImportEntry", () => {
  it("accepts a full card entry", () => {
    expect(
      cardImportEntry.safeParse({
        nickname: "Fixture Alpha Amex",
        issuer: "Fixture Financial",
        network: "AMEX",
        annualFeeMinor: 15000,
        dueDay: 15,
        rewards: FIXTURE_CARDS[0].rewards,
      }).success,
    ).toBe(true);
  });

  it("rejects a bad network and out-of-range due days", () => {
    const good = {
      nickname: "x",
      issuer: "y",
      network: "AMEX",
      rewards: FIXTURE_CARDS[0].rewards,
    };
    expect(cardImportEntry.safeParse({ ...good, network: "DINERS" }).success).toBe(false);
    expect(cardImportEntry.safeParse({ ...good, dueDay: 31 }).success).toBe(false);
  });
});
