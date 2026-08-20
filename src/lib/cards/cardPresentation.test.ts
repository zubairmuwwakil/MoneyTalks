import { describe, expect, it } from "vitest";
import {
  getCardEarnHighlights,
  getCardInsuranceHighlights,
  getCardBranding,
  buildCheatSheetRecommendations,
} from "./cardPresentation";
import { catalogueCard } from "./catalogueCard";

describe("cardPresentation", () => {
  it("extracts top earn multipliers for Amex Cobalt", () => {
    const cobalt = catalogueCard("amex-cobalt");
    const highlights = getCardEarnHighlights(cobalt);
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[0].rate).toBe("5×");
    expect(highlights[0].label).toContain("Dining");
  });

  it("extracts 0% FX fee highlight for cards with no FX markup", () => {
    const ws = catalogueCard("wealthsimple-vip");
    const highlights = getCardEarnHighlights(ws);
    expect(highlights.some((h) => h.rate === "0% FX Fee")).toBe(true);
  });

  it("extracts insurance benefits for premium cards", () => {
    const platInsurance = getCardInsuranceHighlights("amex-platinum");
    expect(platInsurance.length).toBeGreaterThan(0);
    expect(platInsurance.some((b) => b.kind === "purchaseProtection")).toBe(true);
  });

  it("returns appropriate visual branding themes per card", () => {
    const cobaltBrand = getCardBranding("AMEX", "American Express", "Amex Cobalt");
    expect(cobaltBrand.borderClass).toContain("blue");

    const tangerineBrand = getCardBranding("MASTERCARD", "Tangerine", "Tangerine Money-Back");
    expect(tangerineBrand.borderClass).toContain("orange");
  });

  it("builds cheat sheet category recommendations correctly obeying Costco Mastercard constraint", () => {
    const cards = [
      { id: "1", nickname: "Amex Cobalt", network: "AMEX", contractCardId: "amex-cobalt" },
      { id: "2", nickname: "Rogers World Elite", network: "MASTERCARD", contractCardId: "rogers-red-we-mc" },
      { id: "3", nickname: "Scotia Momentum VI", network: "VISA", contractCardId: "scotia-momentum-vi" },
    ];

    const cheatSheet = buildCheatSheetRecommendations(cards);
    expect(cheatSheet.length).toBe(8);

    const costco = cheatSheet.find((c) => c.id === "costco");
    expect(costco?.bestCardName).toBe("Rogers World Elite"); // Only Mastercard eligible

    const dining = cheatSheet.find((c) => c.id === "dining");
    expect(dining?.bestCardName).toBe("Amex Cobalt");
  });
});
