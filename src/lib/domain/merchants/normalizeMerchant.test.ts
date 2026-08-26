import { describe, expect, it } from "vitest";
import { foldMerchantText, normalizeMerchant } from "./normalizeMerchant";

const key = (raw: string) => normalizeMerchant(raw).brandKey;

describe("processor branding", () => {
  it("strips a Square prefix and names the processor", () => {
    const result = normalizeMerchant("SQ *CAFE METRO");
    expect(result.brandKey).toBe("cafe metro");
    expect(result.processor).toBe("square");
  });

  it("handles the spacing variants the same merchant produces on different days", () => {
    expect(key("SQ *CAFE METRO")).toBe("cafe metro");
    expect(key("SQ*CAFE METRO")).toBe("cafe metro");
    expect(key("SQ  * CAFE METRO")).toBe("cafe metro");
  });

  it("recognizes Toast, PayPal, DoorDash and Uber", () => {
    expect(normalizeMerchant("TST* THE KEG - YONGE").processor).toBe("toast");
    expect(normalizeMerchant("PAYPAL *STEAMGAMES").processor).toBe("paypal");
    expect(normalizeMerchant("DD *DOORDASH SUSHI").processor).toBe("doordash");
    expect(normalizeMerchant("UBER   *EATS").processor).toBe("uber");
  });

  it("keeps the merchant half of an unrecognized NAME*THING prefix", () => {
    const result = normalizeMerchant("ABC*LOCAL BAKERY");
    expect(result.brandKey).toBe("local bakery");
    expect(result.processor).toBe("abc");
  });

  it("reports an empty key when the descriptor was nothing but branding", () => {
    const result = normalizeMerchant("SQ *");
    expect(result.brandKey).toBe("");
    expect(result.processor).toBe("square");
  });
});

describe("store numbers and locality", () => {
  it("strips a store number and a trailing city + province", () => {
    const result = normalizeMerchant("TIM HORTONS #4021 TORONTO ON");
    expect(result.brandKey).toBe("tim hortons");
    expect(result.storeNumber).toBe("4021");
    expect(result.locality).toBe("TORONTO ON");
  });

  it("gives every visit to one shop the same key", () => {
    expect(key("TIM HORTONS #4021 TORONTO ON")).toBe(key("TIM HORTONS #118 OTTAWA ON"));
  });

  it("handles a two-word city when the opener says it is one", () => {
    const result = normalizeMerchant("LOBLAWS 1032 NORTH YORK ON");
    expect(result.brandKey).toBe("loblaws");
    expect(result.locality).toBe("NORTH YORK ON");
  });

  it("never eats a brand word to make a two-word city", () => {
    // The regression: a greedy two-word city turned this into "t t", which
    // matches nothing. Leaving a token behind is safe (a match key is a
    // whole-word substring); eating one is not.
    const result = normalizeMerchant("T&T SUPERMARKET RICHMOND BC");
    expect(result.brandKey).toBe("t t supermarket");
    expect(result.locality).toBe("RICHMOND BC");
  });

  it("does not treat the merchant name as a city on a bare 'NAME PR'", () => {
    // "ESSO ON" is a merchant in Ontario, not a city called Esso.
    const result = normalizeMerchant("ESSO ON");
    expect(result.brandKey).toBe("esso");
    expect(result.locality).toBe("ON");
  });

  it("strips a US state for cross-border spend", () => {
    const result = normalizeMerchant("WHOLE FOODS MKT SEATTLE WA");
    expect(result.locality).toBe("SEATTLE WA");
    // "mkt" survives, and that is fine: "whole foods" is still a whole-word
    // substring of the key, so the pack still matches it.
    expect(result.brandKey).toBe("whole foods mkt");
  });

  it("drops a long reference number instead of keeping it as a store number", () => {
    const result = normalizeMerchant("HYDRO ONE 480212993716");
    expect(result.brandKey).toBe("hydro one");
    expect(result.storeNumber).toBeNull();
  });
});

describe("transaction noise", () => {
  it("strips issuer and terminal words", () => {
    expect(key("POS PURCHASE METRO 1234")).toBe("metro");
    expect(key("VISA DEBIT PURCHASE SOBEYS")).toBe("sobeys");
  });

  it("gives a pending authorization the same key as its settled form", () => {
    expect(key("UBER *EATS PENDING")).toBe(key("UBER *EATS"));
  });

  it("keeps the name when the name is itself a noise word", () => {
    // A merchant genuinely called "Payment" must not normalize to nothing.
    expect(key("PAYMENT")).toBe("payment");
  });
});

describe("fullKey: some brands are their own processor", () => {
  it("keeps the merchant when stripping the prefix would delete it", () => {
    // "UBER *EATS" stripped of "uber *" becomes "eats" — not a lookup failure,
    // a self-inflicted one. fullKey is the un-stripped form for exactly this.
    const result = normalizeMerchant("UBER *EATS PENDING");
    expect(result.brandKey).toBe("eats");
    expect(result.fullKey).toBe("uber eats");
  });

  it("keeps a merchant embedded after a genuine processor prefix", () => {
    // The opposite failure: DoorDash IS a processor here, and the merchant
    // name only exists after the prefix, so fullKey alone would carry noise.
    const result = normalizeMerchant("DD *DOORDASH SUSHIMOTO");
    expect(result.brandKey).toBe("doordash sushimoto");
    expect(result.fullKey).toBe("dd doordash sushimoto");
  });

  it("does the same for Amazon and Rogers", () => {
    expect(normalizeMerchant("AMZN Mktp CA*RT4XY9013").fullKey).toContain("amzn");
    // "mthly" isn't a recognized noise token, so it survives in fullKey — and
    // that's fine: the pack's "rogers" key still matches it as a whole word.
    expect(normalizeMerchant("ROGERS *WIRELESS MTHLY").fullKey).toBe("rogers wireless mthly");
  });
});

describe("folding", () => {
  it("folds diacritics and case so one merchant is one key", () => {
    expect(foldMerchantText("Réno-Dépôt")).toBe("reno depot");
    expect(key("PROVIGO LE MARCHÉ")).toBe("provigo le marche");
  });

  it("collapses punctuation runs", () => {
    expect(key("MCDONALD'S #1234")).toBe("mcdonald s");
    expect(key("A&W  CANADA")).toBe("a w canada");
  });

  it("is total: null, empty and whitespace produce an empty key, not a throw", () => {
    for (const input of [null, undefined, "", "   "]) {
      const result = normalizeMerchant(input);
      expect(result.brandKey).toBe("");
      expect(result.raw).toBe("");
    }
  });
});
