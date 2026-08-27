import { describe, it, expect } from "vitest";
import {
  catalogueCard,
  catalogueCredits,
  catalogueCreditsRealizedMinor,
  creditPeriodKey,
  effectiveAnnualFeeMinor,
  feeWaiverNote,
  catalogueChoices,
  getCardPerksSummary,
} from "./catalogueCard";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";

describe("catalogueCard", () => {
  it("resolves a linked card to its catalogue product", () => {
    expect(catalogueCard("amex-cobalt")?.officialName).toBe("American Express Cobalt Card");
  });

  // A null contractCardId is a legacy or unlinked row, not an error: the card
  // still exists and the UI prompts the user to link it rather than guessing.
  it("returns null for an unlinked card rather than guessing", () => {
    expect(catalogueCard(null)).toBeNull();
    expect(catalogueCard("not-a-real-card")).toBeNull();
  });
});

describe("catalogueCredits", () => {
  it("reads credits off the catalogue, not off the card row", () => {
    const credits = catalogueCredits("amex-platinum");
    expect(credits.map((c) => c.creditId).sort()).toEqual(["platinum-dining-credit", "platinum-travel-credit"]);
    expect(credits.every((c) => c.value.amount === 200 && c.value.currency === "CAD")).toBe(true);
  });

  it("treats a card with no credits as having none, not unknown", () => {
    expect(catalogueCredits("amex-cobalt")).toEqual([]);
    expect(catalogueCredits(null)).toEqual([]);
  });
});

describe("catalogueCreditsRealizedMinor", () => {
  const credits = catalogueCredits("amex-platinum");

  it("counts only credits the owner marked redeemed in the current period", () => {
    const redeemed = [{ creditId: "platinum-travel-credit", periodKey: "2026-07-01" }];
    expect(catalogueCreditsRealizedMinor(credits, redeemed, "2026-08-19", "07-01")).toBe(20_000);
  });

  it("ignores a redemption from a previous period", () => {
    const redeemed = [{ creditId: "platinum-travel-credit", periodKey: "2025" }];
    expect(catalogueCreditsRealizedMinor(credits, redeemed, "2026-08-19", "07-01")).toBe(0);
  });

  it("does not invent an account-year window without an owner-confirmed anniversary", () => {
    const redeemed = [{ creditId: "platinum-travel-credit", periodKey: "2026-07-01" }];
    expect(catalogueCreditsRealizedMinor(credits, redeemed, "2026-08-19")).toBe(0);
  });

  it("keys account-year credits from the recorded anniversary, not January 1", () => {
    expect(creditPeriodKey("accountYear", "2026-06-30", "07-01")).toBe("2025-07-01");
    expect(creditPeriodKey("accountYear", "2026-07-01", "07-01")).toBe("2026-07-01");
    expect(creditPeriodKey("accountYear", "2026-08-19", null)).toBeNull();
  });
});

describe("effectiveAnnualFeeMinor", () => {
  it("subtracts the rebate the owner told us they receive", () => {
    expect(effectiveAnnualFeeMinor(12_000, 12_000)).toBe(0);
    expect(effectiveAnnualFeeMinor(15_000, 4_000)).toBe(11_000);
  });

  // The owner's own arrangement is theirs to state; we never let it go
  // negative and read as though the issuer pays them to hold the card.
  it("never returns a negative fee", () => {
    expect(effectiveAnnualFeeMinor(12_000, 99_000)).toBe(0);
  });
});

describe("feeWaiverNote", () => {
  // The catalogue records what the issuer actually offers, including tiers.
  // The hub used to flatten Scotia Gold to a single $120 number, which is not
  // what the issuer says; the prose is shown instead of inventing a figure.
  it("surfaces the issuer's own waiver wording where there is one", () => {
    expect(feeWaiverNote("scotia-gold-amex")).toContain("Ultimate Package");
  });

  it("returns null where the issuer offers no waiver", () => {
    expect(feeWaiverNote("amex-cobalt")).toBeNull();
    expect(feeWaiverNote(null)).toBeNull();
  });
});

describe("catalogueChoices", () => {
  it("offers every card to the explicitly unverified-aware add-card picker", () => {
    const choices = catalogueChoices();
    expect(choices).toHaveLength(cardCatalogue.cards.length);
    expect(new Set(choices.map((c) => c.contractCardId)).size).toBe(cardCatalogue.cards.length);

    const drafts = cardCatalogue.cards.filter((c) => c.status === "draft");
    expect(drafts.length).toBeGreaterThan(0);
    const offered = new Set(choices.map((c) => c.contractCardId));
    expect(drafts.every((d) => offered.has(d.cardId))).toBe(true);
    expect(choices.filter((c) => c.status === "draft")).toHaveLength(drafts.length);
  });

  it("carries the facts the add-card form prefills, and no rate data", () => {
    const cobalt = catalogueChoices().find((c) => c.contractCardId === "amex-cobalt")!;
    expect(cobalt).toEqual({
      contractCardId: "amex-cobalt",
      officialName: "American Express Cobalt Card",
      issuer: "American Express Canada",
      network: "AMEX",
      market: "CA",
      billingCurrency: "CAD",
      status: "published",
      annualFeeMinor: 19_188,
    });
  });

  it("keeps a draft fee in its own currency instead of silently converting it to CAD", () => {
    const usDraft = catalogueChoices().find((choice) => choice.contractCardId === "american-express-business-gold-card")!;
    expect(usDraft).toMatchObject({
      market: "US",
      billingCurrency: "USD",
      status: "draft",
      annualFeeMinor: 37_500,
    });
  });

  it("is grouped by issuer and alphabetical within it, so the picker is stable", () => {
    const choices = catalogueChoices();
    const ordered = [...choices].sort((a, b) =>
      a.issuer === b.issuer ? a.officialName.localeCompare(b.officialName) : a.issuer.localeCompare(b.issuer),
    );
    expect(choices.map((c) => c.contractCardId)).toEqual(ordered.map((c) => c.contractCardId));
    // Every card of an issuer is contiguous — no issuer appears in two runs.
    const issuers = choices.map((c) => c.issuer);
    expect(new Set(issuers).size).toBe(issuers.filter((v, i) => issuers[i - 1] !== v).length);
  });
});

describe("getCardPerksSummary", () => {
  it("extracts top multipliers, zero fx, credits, and waiver details for cards", () => {
    const cobalt = getCardPerksSummary("amex-cobalt");
    expect(cobalt).not.toBeNull();
    expect(cobalt?.programName).toBe("Membership Rewards");
    expect(cobalt?.topMultipliers.length).toBeGreaterThan(0);
    expect(cobalt?.topMultipliers[0].earnText).toBe("5x");

    const scotiaPassport = getCardPerksSummary("scotia-passport-visa-infinite-plus");
    expect(scotiaPassport?.hasZeroFx).toBe(true);

    const amexPlat = getCardPerksSummary("amex-platinum");
    expect(amexPlat?.credits.length).toBe(2);
  });

  it("returns null for non-existent card ID or null", () => {
    expect(getCardPerksSummary(null)).toBeNull();
    expect(getCardPerksSummary("not-a-card")).toBeNull();
  });
});
