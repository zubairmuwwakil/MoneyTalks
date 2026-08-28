import { describe, expect, it } from "vitest";
import { findRateFields } from "./check-no-card-rate-model.mjs";

const clean = `
model CreditCard {
  id             String  @id
  nickname       String
  limitMinor     Int?
  annualFeeMinor Int     @default(0)
  feeRebateMinor Int     @default(0)
  contractCardId String?
}
`;

describe("findRateFields", () => {
  it("passes the real per-user shape: fee and rebate columns are the owner's copy", () => {
    expect(findRateFields(clean)).toEqual([]);
  });

  it("catches a reintroduced rewards field", () => {
    const drifted = clean.replace("contractCardId String?", "rewards Json?\n  contractCardId String?");
    expect(findRateFields(drifted)).toEqual(["rewards"]);
  });

  it("catches a multiplier column", () => {
    const drifted = clean.replace("limitMinor     Int?", "earnMultiplier Decimal?");
    expect(findRateFields(drifted)).toEqual(["earnMultiplier"]);
  });

  it("catches a category cap column", () => {
    const drifted = clean.replace("limitMinor     Int?", "monthlyCapMinor Int?");
    expect(findRateFields(drifted)).toEqual(["monthlyCapMinor"]);
  });

  it("ignores rate-shaped fields on models that are not CreditCard", () => {
    expect(findRateFields(`${clean}\nmodel Offer {\n  rewardRate Decimal\n}\n`)).toEqual([]);
  });
});
