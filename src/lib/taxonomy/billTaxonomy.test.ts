import { describe, expect, it } from "vitest";
import {
  BILL_PARENT_CATEGORIES,
  BILL_SUBCATEGORY_MAP,
  formatBillCategoryLabel,
  getAllValidBillCategoryIds,
  resolveBillTaxonomy,
} from "./billTaxonomy";

describe("billTaxonomy structure", () => {
  it("contains all 13 parent categories", () => {
    expect(BILL_PARENT_CATEGORIES.length).toBe(13);
    const parentIds = BILL_PARENT_CATEGORIES.map((p) => p.id);
    expect(parentIds).toContain("housing");
    expect(parentIds).toContain("utilities");
    expect(parentIds).toContain("insurance");
    expect(parentIds).toContain("transportation");
    expect(parentIds).toContain("debt");
    expect(parentIds).toContain("subscriptions");
    expect(parentIds).toContain("government");
    expect(parentIds).toContain("health");
    expect(parentIds).toContain("education");
    expect(parentIds).toContain("financial");
    expect(parentIds).toContain("family");
    expect(parentIds).toContain("donations");
    expect(parentIds).toContain("other");
  });

  it("contains all 58 subcategories without duplicate IDs", () => {
    const allSubs = BILL_PARENT_CATEGORIES.flatMap((p) => p.subcategories);
    expect(allSubs.length).toBe(58);
    const uniqueIds = new Set(allSubs.map((s) => s.id));
    expect(uniqueIds.size).toBe(58);
  });

  it("every subcategory belongs to a valid parent and has icon & labels", () => {
    for (const [id, sub] of BILL_SUBCATEGORY_MAP.entries()) {
      expect(sub.id).toBe(id);
      expect(sub.label.length).toBeGreaterThan(0);
      expect(sub.parentLabel.length).toBeGreaterThan(0);
      expect(sub.icon.length).toBeGreaterThan(0);
      expect(sub.parentId.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveBillTaxonomy", () => {
  it("resolves specific granular subcategory tokens", () => {
    const streaming = resolveBillTaxonomy("subscriptions:streaming");
    expect(streaming.id).toBe("subscriptions:streaming");
    expect(streaming.parentId).toBe("subscriptions");
    expect(streaming.defaultSpendCategory).toBe("streaming");
    expect(streaming.isCardExcluded).toBe(false);

    const rent = resolveBillTaxonomy("housing:rent");
    expect(rent.id).toBe("housing:rent");
    expect(rent.parentId).toBe("housing");
    expect(rent.isCardExcluded).toBe(true);
    expect(rent.defaultPaymentRail).toBe("pad");
    expect(rent.intermediaryTarget).toBe("chexy");

    const propertyTax = resolveBillTaxonomy("housing:property_tax");
    expect(propertyTax.id).toBe("housing:property_tax");
    expect(propertyTax.isCardExcluded).toBe(true);
    expect(propertyTax.intermediaryTarget).toBe("triangle-bill-pay");

    const hydro = resolveBillTaxonomy("utilities:electricity_hydro");
    expect(hydro.id).toBe("utilities:electricity_hydro");
    expect(hydro.defaultSpendCategory).toBe("householdUtilities");

    const ev = resolveBillTaxonomy("transportation:ev_charging");
    expect(ev.id).toBe("transportation:ev_charging");
    expect(ev.defaultSpendCategory).toBe("evCharging");

    const studentLoan = resolveBillTaxonomy("debt:student_loan");
    expect(studentLoan.id).toBe("debt:student_loan");
    expect(studentLoan.isCardExcluded).toBe(true);
  });

  it("resolves legacy coarse category tokens with 100% backward compatibility", () => {
    const utilities = resolveBillTaxonomy("utilities");
    expect(utilities.parentId).toBe("utilities");
    expect(utilities.defaultSpendCategory).toBe("householdUtilities");

    const housing = resolveBillTaxonomy("housing");
    expect(housing.parentId).toBe("housing");
    expect(housing.isCardExcluded).toBe(true);

    const subscriptions = resolveBillTaxonomy("subscriptions");
    expect(subscriptions.parentId).toBe("subscriptions");
    expect(subscriptions.defaultSpendCategory).toBe("digitalMedia");

    const other = resolveBillTaxonomy("other");
    expect(other.parentId).toBe("other");
    expect(other.defaultSpendCategory).toBe("recurring");
  });

  it("handles null / empty / undefined cleanly", () => {
    expect(resolveBillTaxonomy(null).id).toBe("other:uncategorized");
    expect(resolveBillTaxonomy("").id).toBe("other:uncategorized");
    expect(resolveBillTaxonomy(undefined).id).toBe("other:uncategorized");
  });
});

describe("formatBillCategoryLabel", () => {
  it("formats badges nicely with icon and formatted parent/sub text", () => {
    expect(formatBillCategoryLabel("subscriptions:streaming")).toBe("🍿 Subscriptions & Memberships · Streaming (Video & Music)");
    expect(formatBillCategoryLabel("housing:rent")).toBe("🏠 Housing · Rent");
    expect(formatBillCategoryLabel("utilities:electricity_hydro")).toBe("💡 Utilities & Communications · Electricity / Hydro");
  });
});

describe("getAllValidBillCategoryIds", () => {
  it("returns comprehensive set of all valid category identifiers", () => {
    const ids = getAllValidBillCategoryIds();
    expect(ids).toContain("housing");
    expect(ids).toContain("housing:rent");
    expect(ids).toContain("utilities:electricity_hydro");
    expect(ids).toContain("debt:student_loan");
    expect(ids).toContain("donations:recurring");
    expect(ids.length).toBeGreaterThan(65);
  });
});
