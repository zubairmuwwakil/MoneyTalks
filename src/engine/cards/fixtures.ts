import type { CardDef } from "./types";

export const FIXTURE_CARDS: CardDef[] = [
  {
    id: "alpha",
    nickname: "Fixture Alpha Amex",
    network: "AMEX",
    annualFeeMinor: 15_000,
    rewards: {
      pointValueCents: 1.2,
      fxFeePct: 2.5,
      baseMultiplier: 1,
      categoryRates: [
        { category: "dining", multiplier: 5 },
        { category: "groceries", multiplier: 4, capMinor: 150_000, capWindow: "MONTH" },
      ],
      credits: [{ id: "dine100", label: "$100 dining credit", valueMinor: 10_000, period: "YEAR" }],
    },
  },
  {
    id: "beta",
    nickname: "Fixture Beta Visa",
    network: "VISA",
    annualFeeMinor: 0,
    rewards: {
      pointValueCents: 1,
      fxFeePct: 2.5,
      baseMultiplier: 1.5,
      categoryRates: [{ category: "groceries", multiplier: 3 }],
      credits: [],
    },
  },
  {
    id: "gamma",
    nickname: "Fixture Gamma MC",
    network: "MASTERCARD",
    annualFeeMinor: 12_000,
    rewards: {
      pointValueCents: 1,
      fxFeePct: 0,
      baseMultiplier: 2,
      categoryRates: [],
      credits: [{ id: "travel90", label: "$90 travel credit", valueMinor: 9_000, period: "YEAR" }],
    },
  },
];
