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

  it("requires issuer provenance for every catalogue credit", () => {
    const credits = cardCatalogue.cards.flatMap((card) => card.credits ?? []);
    expect(credits).not.toHaveLength(0);
    expect(credits.every((credit) => credit.sourceType === "issuerConfirmed")).toBe(true);
    expect(credits.every((credit) => credit.sources.every((source) => new URL(source).protocol === "https:"))).toBe(true);
  });

  it("rejects a credit without its issuer source URL", () => {
    const mutated = structuredClone(cardCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    const credits = cards[0].credits as Array<Record<string, unknown>>;
    delete credits[0].sources;
    expect(() => parseCardCatalogue(mutated)).toThrow(/sources/);
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

  // The cases below pin this loader to schema/benefits-catalogue.schema.json rather
  // than to whatever data happens to be vendored today. The first three failed before
  // the loader was aligned to that schema — it was stricter than the contract in two
  // ways and looser in one. The fourth guards a property that was already correct and
  // must stay that way.

  it("accepts an explicitly null exclusions, which the schema permits", () => {
    // exclusions is [String]? in Swift and ["array","null"] in the schema, so an
    // explicit null is valid data — .optional() alone used to reject it.
    const mutated = structuredClone(benefitsCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    const benefits = cards[0].benefits as Array<Record<string, unknown>>;
    benefits[0].exclusions = null;
    expect(() => parseBenefitsCatalogue(mutated)).not.toThrow();
  });

  it("accepts \"_\"-prefixed annotations on a benefit and on a card entry", () => {
    // Both objects declare patternProperties "^_" in the schema; strictObject
    // used to reject the annotations the contract explicitly allows.
    const mutated = structuredClone(benefitsCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    cards[0]._note = "sourced from the 2025-07 certificate";
    const benefits = cards[0].benefits as Array<Record<string, unknown>>;
    benefits[0]._note = "sublimits omitted";
    expect(() => parseBenefitsCatalogue(mutated)).not.toThrow();
  });

  it("rejects a three-part benefitsCatalogueVersion", () => {
    // spec §3 fixes the format at MAJOR.MINOR; the pre-1.0 "0.2.0" was a
    // contract violation this loader should surface rather than wave through.
    const mutated = structuredClone(benefitsCatalogueRaw) as Record<string, unknown>;
    mutated.benefitsCatalogueVersion = "0.2.0";
    expect(() => parseBenefitsCatalogue(mutated)).toThrow();
  });

  it("still accepts an unknown benefit family or kind (open vocabulary)", () => {
    // The mirror of the verificationStatus test above: family/kind are plain
    // strings in Swift and unknown values are ignored, not rejected. Tightening
    // these into enums would break forward compatibility.
    const mutated = structuredClone(benefitsCatalogueRaw) as Record<string, unknown>;
    const cards = mutated.cards as Array<Record<string, unknown>>;
    const benefits = cards[0].benefits as Array<Record<string, unknown>>;
    benefits[0].family = "someFutureFamily";
    benefits[0].kind = "cellPlanInsurance";
    expect(() => parseBenefitsCatalogue(mutated)).not.toThrow();
  });
});
