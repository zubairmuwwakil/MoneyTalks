import { describe, expect, it } from "vitest";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import {
  CATEGORIES,
  LEGACY_CATEGORY_ALIASES,
  RULE_SIDE_CATEGORY_TOKENS,
  categoryQueryTokens,
  categoryParentIDs,
  getCategoryMeta,
  merchantGroupID,
  normalizeCategoryId,
  normalizePurchaseCategoryId,
} from "./categories";

/** Every category token any earn rule in the vendored catalogue names. */
function catalogueCategoryTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const card of cardCatalogue.cards) {
    for (const rule of card.earnRules) {
      for (const category of rule.predicate.categories ?? []) tokens.add(category);
    }
  }
  return tokens;
}

describe("category vocabulary is the catalogue's", () => {
  it("offers every scorable catalogue category", () => {
    const offered = new Set<string>(CATEGORIES.map((c) => c.id));
    const missing = [...catalogueCategoryTokens()]
      .filter((token) => !RULE_SIDE_CATEGORY_TOKENS.has(token))
      .filter((token) => !offered.has(token))
      .sort();
    // A category the engine can score but the owner cannot pick pushes real
    // spend into whichever neighbouring option happened to be on screen.
    expect(missing, `catalogue categories with no picker entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("marks a category scorable if and only if the catalogue scores it", () => {
    const scoredByCatalogue = catalogueCategoryTokens();
    for (const category of CATEGORIES) {
      expect(category.scorable, `${category.id}.scorable`).toBe(scoredByCatalogue.has(category.id));
    }
  });

  it("never offers a rule-side marker in the picker", () => {
    for (const category of CATEGORIES) {
      expect(RULE_SIDE_CATEGORY_TOKENS.has(category.id), category.id).toBe(false);
    }
  });

  it("gets every rule-side marker from the contract", () => {
    expect([...RULE_SIDE_CATEGORY_TOKENS].sort()).toEqual([
      "foreignCurrency",
      "ownerSelectedCategory",
      "ownerSelectedTangerineCategory",
      "recurring",
    ]);
  });

  it("has no duplicate ids", () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
  });

  it("resolves every legacy alias to a real category", () => {
    const known = new Set<string>(CATEGORIES.map((c) => c.id));
    for (const [legacy, target] of Object.entries(LEGACY_CATEGORY_ALIASES)) {
      expect(known.has(target), `${legacy} -> ${target}`).toBe(true);
    }
  });
});

describe("normalizeCategoryId", () => {
  it("maps the pre-convergence ids onto catalogue tokens", () => {
    // The five that silently failed to score before the convergence.
    expect(normalizeCategoryId("groceries")).toBe("grocery");
    expect(normalizeCategoryId("gas")).toBe("gasStation");
    expect(normalizeCategoryId("bills")).toBe("householdUtilities");
    expect(normalizeCategoryId("drugstore")).toBe("drugStore");
    expect(normalizeCategoryId("hotel")).toBe("lodging");
  });

  it("maps legacy retail and home buckets to the current engine categories", () => {
    expect(normalizeCategoryId("shopping")).toBe("retailShopping");
    expect(normalizeCategoryId("home_improvement")).toBe("homeImprovement");
    expect(normalizeCategoryId("online_foreign")).toBe("other");
  });

  it("passes catalogue tokens through untouched", () => {
    for (const category of CATEGORIES) {
      expect(normalizeCategoryId(category.id)).toBe(category.id);
    }
  });

  it("accepts rule-side tokens as stored values without offering them", () => {
    expect(normalizeCategoryId("recurring")).toBe("recurring");
  });

  it("tolerates case differences", () => {
    expect(normalizeCategoryId("GROCERY")).toBe("grocery");
    expect(normalizeCategoryId("gasstation")).toBe("gasStation");
  });

  it("returns null for a value nothing can score, rather than laundering it", () => {
    // The old implementation fell through to `return cleaned`, so a typo
    // entered the system as a category and read back looking legitimate.
    expect(normalizeCategoryId("groserys")).toBeNull();
    expect(normalizeCategoryId("")).toBeNull();
    expect(normalizeCategoryId(null)).toBeNull();
  });
});

describe("normalizePurchaseCategoryId", () => {
  it("exposes contract hierarchy as metadata without changing leaf ids", () => {
    expect(categoryParentIDs("marriottDirect")).toEqual(["lodging", "travel"]);
    expect(merchantGroupID("marriottDirect")).toBe("marriottDirect");
  });

  it("accepts canonical categories and legacy aliases", () => {
    expect(normalizePurchaseCategoryId("grocery")).toBe("grocery");
    expect(normalizePurchaseCategoryId("groceries")).toBe("grocery");
  });

  it("rejects rule-side tokens and unknown strings", () => {
    expect(normalizePurchaseCategoryId("recurring")).toBeNull();
    expect(normalizePurchaseCategoryId("foreignCurrency")).toBeNull();
    expect(normalizePurchaseCategoryId("ownerSelectedTangerineCategory")).toBeNull();
    expect(normalizePurchaseCategoryId("coffee_shops")).toBeNull();
  });
});

describe("categoryQueryTokens", () => {
  it("finds rows written in either vocabulary", () => {
    const tokens = categoryQueryTokens("grocery");
    expect(tokens).toContain("grocery");
    expect(tokens).toContain("groceries");
  });

  it("covers every legacy spelling of a category, derived not hand-listed", () => {
    const tokens = categoryQueryTokens("householdUtilities");
    for (const legacy of ["bills", "utilities", "recurring_bills"]) {
      expect(tokens, legacy).toContain(legacy);
    }
  });

  it("falls back to the literal value when nothing resolves", () => {
    expect(categoryQueryTokens("groserys")).toEqual(["groserys"]);
  });
});

describe("getCategoryMeta", () => {
  it("renders a legacy stored value with its converged label", () => {
    expect(getCategoryMeta("groceries").label).toBe("Groceries");
    expect(getCategoryMeta("groceries").id).toBe("grocery");
  });

  it("shows an unrecognized value as itself rather than relabelling it Other", () => {
    const meta = getCategoryMeta("groserys");
    expect(meta.id).toBe("groserys");
    expect(meta.label).toBe("Groserys");
    expect(meta.scorable).toBe(false);
  });

  it("treats null and 'uncategorized' as uncategorized", () => {
    expect(getCategoryMeta(null).id).toBe("uncategorized");
    expect(getCategoryMeta("uncategorized").icon).toBe("❓");
  });
});
