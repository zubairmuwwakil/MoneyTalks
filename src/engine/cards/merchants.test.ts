import { describe, expect, it } from "vitest";
import { matchMerchant } from "./merchants";

describe("matchMerchant", () => {
  it("finds warehouse clubs with their network restriction", () => {
    const [hit] = matchMerchant("costco");
    expect(hit.category).toBe("warehouse");
    expect(hit.networkRestriction).toBe("MASTERCARD");
  });

  it("knows discount grocers that decline Amex", () => {
    const [hit] = matchMerchant("no frills");
    expect(hit.category).toBe("groceries");
    expect(hit.amexAccepted).toBe(false);
  });

  it("keeps mixed-evidence merchants neutral", () => {
    const [hit] = matchMerchant("food basics");
    expect(hit.category).toBe("groceries");
    expect(hit.amexAccepted).toBeUndefined();
    expect(hit.networkRestriction).toBeUndefined();
  });

  it("matches case-insensitively on substrings", () => {
    expect(matchMerchant("COST")[0]?.name).toBe("Costco (in-store)");
  });

  it("returns empty for unknown merchants", () => {
    expect(matchMerchant("zzz-unknown")).toEqual([]);
  });
});
