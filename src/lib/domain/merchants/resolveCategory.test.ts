import { describe, expect, it } from "vitest";
import {
  isSuggestion,
  purchaseContextFields,
  resolveCategory,
  shouldAutoApply,
} from "./resolveCategory";
import { CATEGORY_BY_MCC, REPRESENTATIVE_MCC_BY_CATEGORY, merchantPack } from "./merchantPack";
import { CATEGORIES, RULE_SIDE_CATEGORY_TOKENS } from "@/lib/categories";

describe("the ladder resolves in strict order", () => {
  it("puts the owner's pin above everything, including a contradicting pack row", () => {
    const result = resolveCategory({
      merchantRaw: "TIM HORTONS #4021 TORONTO ON",
      userOverrideCategory: "grocery",
      aliasCategory: "transit",
    });
    expect(result.category).toBe("grocery");
    expect(result.source).toBe("userOverride");
    expect(result.confidence).toBe("certain");
  });

  it("puts a curated alias above the pack", () => {
    const result = resolveCategory({ merchantRaw: "STARBUCKS #123", aliasCategory: "memberships" });
    expect(result.category).toBe("memberships");
    expect(result.source).toBe("merchantAlias");
  });

  it("accepts a legacy alias value and converges it", () => {
    // A row written before the vocabulary convergence still resolves.
    const result = resolveCategory({ merchantRaw: "SOBEYS", aliasCategory: "groceries" });
    expect(result.category).toBe("grocery");
    expect(result.source).toBe("merchantAlias");
  });

  it("puts an observed MCC above the pack's brand match", () => {
    const result = resolveCategory({ merchantRaw: "SHELL", observedMcc: 5411 });
    expect(result.category).toBe("grocery");
    expect(result.source).toBe("observedMcc");
    expect(result.mccObserved).toBe(true);
  });

  it("puts an email sender domain above the brand key", () => {
    const result = resolveCategory({
      merchantRaw: "UNRECOGNIZABLE STRING",
      emailFromAddress: "noreply@ubereats.com",
    });
    expect(result.category).toBe("foodDelivery");
    expect(result.source).toBe("emailDomain");
    expect(result.merchantId).toBe("uber-eats");
  });

  it("reads a sender domain from an RFC display-name address", () => {
    const result = resolveCategory({
      merchantRaw: "UNRECOGNIZABLE STRING",
      emailFromAddress: "Uber Receipts <noreply@ubereats.com>",
    });
    expect(result.source).toBe("emailDomain");
    expect(result.merchantId).toBe("uber-eats");
  });

  it("resolves a sender subdomain to its parent domain", () => {
    const result = resolveCategory({ emailFromAddress: "receipts@email.marriott.com" });
    expect(result.merchantId).toBe("marriott-hotels-resorts");
  });
});

describe("brand pack matching", () => {
  it("resolves a descriptor through processor branding and store noise", () => {
    const result = resolveCategory({ merchantRaw: "TIM HORTONS #4021 TORONTO ON" });
    expect(result.category).toBe("dining");
    expect(result.source).toBe("brandPack");
    expect(result.displayName).toBe("Tim Hortons");
    expect(result.mcc).toBe(5814);
  });

  it("lets the more specific brand key win", () => {
    // Both "walmart" and "walmart supercentre" are keys, for merchants with
    // different categories. Longest match wins.
    expect(resolveCategory({ merchantRaw: "WALMART SUPERCENTRE #3106" }).category).toBe("grocery");
    expect(resolveCategory({ merchantRaw: "WALMART #1055 BARRIE ON" }).category).toBe("other");
  });

  it("matches only on whole words", () => {
    // "esso" is inside "espresso"; a substring matcher would call this gas.
    const result = resolveCategory({ merchantRaw: "ESPRESSO BAR YYZ" });
    expect(result.source).not.toBe("brandPack");
  });

  it("refuses the pack when the brand key is a different merchant entirely", () => {
    const result = resolveCategory({ merchantRaw: "SQ *DR PATEL DENTISTRY" });
    expect(result.category).toBeNull();
    expect(result.source).toBe("none");
  });
});

describe("processor priors are offered, never applied", () => {
  it("suggests dining for an unknown merchant on a restaurant-only processor", () => {
    const result = resolveCategory({ merchantRaw: "TST* MAMAKAS TAVERNA" });
    expect(result.category).toBe("dining");
    expect(result.source).toBe("processorPrior");
    expect(result.confidence).toBe("medium");
    expect(shouldAutoApply(result)).toBe(false);
    expect(isSuggestion(result)).toBe(true);
  });

  it("has no prior for a processor that serves every trade", () => {
    // Square takes payments for barbers, market stalls and dentists alike.
    const result = resolveCategory({ merchantRaw: "SQ *SOME NEW PLACE" });
    expect(result.category).toBeNull();
  });
});

describe("the auto-apply gate", () => {
  it("auto-applies certain and high, and nothing below", () => {
    expect(shouldAutoApply(resolveCategory({ merchantRaw: "TIM HORTONS" }))).toBe(true);
    expect(shouldAutoApply(resolveCategory({ merchantRaw: "X", aliasCategory: "dining" }))).toBe(true);
    expect(shouldAutoApply(resolveCategory({ merchantRaw: "TST* NEW PLACE" }))).toBe(false);
    expect(shouldAutoApply(resolveCategory({ merchantRaw: "TOTALLY UNKNOWN LLC" }))).toBe(false);
  });

  it("never treats an unresolved merchant as a suggestion", () => {
    const result = resolveCategory({ merchantRaw: "TOTALLY UNKNOWN LLC" });
    expect(isSuggestion(result)).toBe(false);
    expect(result.category).toBeNull();
  });
});

describe("the MCC obligation", () => {
  it("marks a pack MCC as not observed, because the pack is editorial research", () => {
    const result = resolveCategory({ merchantRaw: "PETRO-CANADA #1234" });
    expect(result.mcc).toBe(5541);
    expect(result.mccObserved).toBe(false);
    expect(purchaseContextFields(result).mccAssumed).toBe(true);
  });

  it("marks a genuinely observed MCC as observed", () => {
    const result = resolveCategory({ merchantRaw: "METRO", observedMcc: 5411 });
    expect(result.mccObserved).toBe(true);
    expect(purchaseContextFields(result).mccAssumed).toBe(false);
  });

  it("always supplies an MCC alongside a category", () => {
    // RuleMatcher treats a null MCC as matching every mccInclude rule
    // unconditionally, so a category without one is a confidently wrong
    // answer rather than a conservative one.
    for (const raw of ["TIM HORTONS", "SHELL", "NETFLIX", "TTC", "COSTCO WHOLESALE"]) {
      const result = resolveCategory({ merchantRaw: raw });
      expect(result.category, raw).not.toBeNull();
      expect(result.mcc, `${raw} resolved a category with no MCC`).not.toBeNull();
    }
  });

  it("supplies a representative MCC for an owner's hand-picked category", () => {
    const result = resolveCategory({ merchantRaw: "ANY", userOverrideCategory: "dining" });
    expect(result.mcc).toBe(REPRESENTATIVE_MCC_BY_CATEGORY.get("dining"));
    expect(result.mccObserved).toBe(false);
  });

  it("scores an unresolved merchant at base rate rather than guessing", () => {
    const fields = purchaseContextFields(resolveCategory({ merchantRaw: "TOTALLY UNKNOWN LLC" }));
    expect(fields.category).toBe("unknown");
    expect(fields.mcc).toBeUndefined();
  });
});

describe("derived code tables stay honest", () => {
  it("refuses to resolve an MCC that means two different things in the pack", () => {
    // 5814 covers both dining and food delivery. Guessing one would silently
    // misprice every Uber Eats order.
    expect(CATEGORY_BY_MCC.has(5814)).toBe(false);
  });

  it("resolves an MCC the pack is unanimous about", () => {
    expect(CATEGORY_BY_MCC.get(5541)).toBe("gasStation");
    expect(CATEGORY_BY_MCC.get(5411)).toBe("grocery");
    expect(CATEGORY_BY_MCC.get(5912)).toBe("drugStore");
  });
});

describe("the pack agrees with this repo's vocabulary", () => {
  it("uses only categories the picker can offer", () => {
    const known = new Set([...CATEGORIES.map((c) => c.id), ...RULE_SIDE_CATEGORY_TOKENS]);
    const strangers = [...new Set(merchantPack.merchants.map((m) => m.category))]
      .filter((category) => !known.has(category))
      .sort();
    // A pack category with no picker entry is a merchant the owner can see
    // categorized but cannot re-categorize.
    expect(strangers, `pack categories with no picker entry: ${strangers.join(", ")}`).toEqual([]);
  });
});
