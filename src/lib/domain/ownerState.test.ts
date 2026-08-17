import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { RecommendationEngine, Catalogue } from "@/engine/cards-twin";
import { defaultOwnerState } from "./ownerState";

const catalogue = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "contracts/card-catalogue.json"), "utf-8"),
) as Catalogue;

describe("defaultOwnerState", () => {
  it("returns null when the user has no contract-linked cards", () => {
    expect(defaultOwnerState([])).toBeNull();
  });

  it("produces a state the real engine can score with", () => {
    const state = defaultOwnerState(["amex-cobalt", "wealthsimple-vip"]);
    expect(state).not.toBeNull();

    const engine = new RecommendationEngine(catalogue, state!);
    const recommendation = engine.recommend(
      { amountCad: 100, currency: "CAD", category: "unknown", merchantBrand: "Test Merchant" },
      "2026-08-17",
    );
    expect(recommendation.winner).toBeTruthy();
    expect(recommendation.allCandidates.length).toBeGreaterThan(0);
    expect(state!.ownedCardIds).toContain(recommendation.winner.cardId);
  });

  it("dedupes contract card ids and uses the first as default", () => {
    const state = defaultOwnerState(["amex-cobalt", "amex-cobalt", "wealthsimple-vip"]);
    expect(state!.ownedCardIds).toEqual(["amex-cobalt", "wealthsimple-vip"]);
    expect(state!.defaultCardId).toBe("amex-cobalt");
  });
});
