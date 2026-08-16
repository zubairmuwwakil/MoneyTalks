import { describe, expect, it } from "vitest";
import {
  benefitsCatalogue,
  benefitsCatalogueSchema,
  cardCatalogue,
  cardCatalogueSchema,
  parseBenefitsCatalogue,
  parseCardCatalogue,
} from "./cardCatalogue";
import cardCatalogueRaw from "../../../contracts/card-catalogue.json";
import benefitsCatalogueRaw from "../../../contracts/benefits-catalogue.json";

describe("parseCardCatalogue", () => {
  it("parses the vendored card-catalogue.json", () => {
    expect(cardCatalogue.cards.length).toBeGreaterThan(0);
    expect(cardCatalogue.currency).toBe("CAD");
  });

  it("round-trips the module-level singleton through the exported parser", () => {
    expect(parseCardCatalogue(cardCatalogueRaw)).toEqual(cardCatalogue);
  });

  it("rejects a card whose fee.annualCad is a string instead of a number", () => {
    const mutated = structuredClone(cardCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    (cards[0].fee as Record<string, unknown>).annualCad = "799";
    expect(() => parseCardCatalogue(mutated)).toThrow(/annualCad/);
  });

  it("rejects an unrecognized network value", () => {
    const mutated = structuredClone(cardCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    cards[0].network = "discover";
    expect(() => parseCardCatalogue(mutated)).toThrow();
  });

  it("rejects a card missing a required field", () => {
    const mutated = structuredClone(cardCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    delete cards[0].lastVerifiedAt;
    expect(() => parseCardCatalogue(mutated)).toThrow();
  });

  it("rejects an unknown non-underscore key (contract drift, not an annotation)", () => {
    const mutated = structuredClone(cardCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    cards[0].newUndocumentedField = "surprise";
    expect(() => parseCardCatalogue(mutated)).toThrow(/Unrecognized key/);
  });

  it("still accepts underscore-prefixed annotation keys", () => {
    const mutated = structuredClone(cardCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    cards[0]._scratchAnnotation = "fine";
    expect(() => parseCardCatalogue(mutated)).not.toThrow();
  });

  it("exposes the same shape via the exported schema directly", () => {
    expect(cardCatalogueSchema.safeParse(cardCatalogueRaw).success).toBe(true);
  });
});

describe("parseBenefitsCatalogue", () => {
  it("parses the vendored benefits-catalogue.json", () => {
    expect(benefitsCatalogue.cards.length).toBeGreaterThan(0);
  });

  it("round-trips the module-level singleton through the exported parser", () => {
    expect(parseBenefitsCatalogue(benefitsCatalogueRaw)).toEqual(benefitsCatalogue);
  });

  it("rejects a benefit whose coverage field is wrong-typed", () => {
    const mutated = structuredClone(benefitsCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    const benefits = cards[0].benefits as Array<Record<string, unknown>>;
    (benefits[0].coverage as Record<string, unknown>).maxPerOccurrenceCad = "a lot";
    expect(() => parseBenefitsCatalogue(mutated)).toThrow(/maxPerOccurrenceCad/);
  });

  it("rejects an unrecognized verificationStatus", () => {
    const mutated = structuredClone(benefitsCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    (cards[0].certificate as Record<string, unknown>).verificationStatus = "rumored";
    expect(() => parseBenefitsCatalogue(mutated)).toThrow();
  });

  it("exposes the same shape via the exported schema directly", () => {
    expect(benefitsCatalogueSchema.safeParse(benefitsCatalogueRaw).success).toBe(true);
  });
});
