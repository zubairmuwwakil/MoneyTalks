import { describe, expect, it } from "vitest";
import {
  cardLabelsMatchSearch,
  confidentCardMatch,
  rankCardMatches,
  scoreCardMatch,
} from "./cardMatch";

type Candidate = { id: string; name: string };

function rank(raw: string, candidates: Candidate[]) {
  return rankCardMatches(raw, candidates, (candidate) => [candidate.name, candidate.id]);
}

describe("card matching", () => {
  it("never treats a network-only Wallet label as a product match", () => {
    expect(scoreCardMatch("Visa", "CIBC Aventura Visa Infinite Card").score).toBe(0);
    expect(
      confidentCardMatch(
        rank("Visa", [
          { id: "cibc-aventura", name: "CIBC Aventura Visa Infinite Card" },
          { id: "td-aeroplan", name: "TD Aeroplan Visa Infinite Card" },
        ]),
      ),
    ).toBeNull();
  });

  it("confidently resolves an exact normalized product name", () => {
    const cobalt = { id: "amex-cobalt", name: "American Express Cobalt Card" };
    expect(
      confidentCardMatch(
        rank("American Express Cobalt", [
          cobalt,
          { id: "amex-gold", name: "American Express Gold Rewards Card" },
        ]),
      ),
    ).toBe(cobalt);
  });

  it("does not choose when two product variants are equally plausible", () => {
    expect(
      confidentCardMatch(
        rank("Aventura Visa", [
          { id: "aventura-infinite", name: "CIBC Aventura Visa Infinite Card" },
          { id: "aventura-gold", name: "CIBC Aventura Visa Gold Card" },
        ]),
      ),
    ).toBeNull();
  });

  it("supports token-based catalogue search", () => {
    expect(cardLabelsMatchSearch(["American Express Cobalt Card"], "amex cobalt")).toBe(true);
    expect(cardLabelsMatchSearch(["TD Aeroplan Visa Infinite Card"], "amex cobalt")).toBe(false);
  });
});
