import { describe, expect, it } from "vitest";
import { matchMerchant, matchMerchantInDescription } from "./merchants";

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

describe("matchMerchantInDescription", () => {
  it("finds a merchant whose name appears inside a statement line", () => {
    const hit = matchMerchantInDescription("NO FRILLS #4471");
    expect(hit?.name).toBe("No Frills");
  });

  it("picks the longest normalized name on overlapping matches", () => {
    const online = matchMerchantInDescription("COSTCO.CA ORDER 88214");
    expect(online?.name).toBe("Costco.ca (online)");

    const inStore = matchMerchantInDescription("COSTCO WHOLESALE #445");
    expect(inStore?.name).toBe("Costco (in-store)");
  });

  it("returns null when nothing matches", () => {
    expect(matchMerchantInDescription("MYSTERY VENDOR 998")).toBeNull();
  });
});
