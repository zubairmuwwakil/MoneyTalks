import { z } from "zod";
import cardCatalogueRaw from "../../../contracts/card-catalogue.json";
import benefitsCatalogueRaw from "../../../contracts/benefits-catalogue.json";

/**
 * Zod mirror of PickMe's contracts/schema/card-catalogue.schema.json (spec:
 * ../PickMe/docs/plans/2026-08-16-card-contract-spec.md §4). Validated on
 * load — nothing here is cast from the raw JSON import's inferred shape.
 *
 * There is no PickMe-authored schema for benefits-catalogue.json (schema/
 * only covers the catalogue and fixtures — see the spec's §1 file listing),
 * so the benefits schema below is hand-derived from the actual vendored data
 * plus PickMe/Engine/Sources/CardCopilotEngine/Models/BenefitsModels.swift,
 * the canonical Swift decode target. Flagged in the chunk-b report.
 */

// Every nested object in card-catalogue.schema.json declares
// `"additionalProperties": false` plus `"patternProperties": {"^_": {}}` —
// closed to unknown keys except free-text "_"-prefixed annotations
// (_note, _foodDeliveryNote, ...). This helper reproduces that: known keys
// are validated per `shape`, "_"-prefixed keys pass through unchecked, and
// anything else is a hard validation failure (the actual case this loader
// exists to catch — a card-catalogue field that drifted from the contract).
function annotatedObject<Shape extends z.ZodRawShape>(shape: Shape) {
  const knownKeys = new Set(Object.keys(shape));
  return z
    .object(shape)
    .catchall(z.unknown())
    .superRefine((value, ctx) => {
      for (const key of Object.keys(value)) {
        if (!knownKeys.has(key) && !key.startsWith("_")) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `Unrecognized key "${key}" — only known catalogue fields or "_"-prefixed annotations are allowed`,
          });
        }
      }
    });
}

const feeSchema = annotatedObject({
  annualCad: z.number().optional(),
  monthlyCad: z.number().optional(),
  billing: z.string().optional(),
  waiver: z.string().optional(),
});

const programSchema = annotatedObject({
  programId: z.enum(["amexMembershipRewards", "marriottBonvoy", "mbnaRewards", "ctMoney", "cro", "cashback"]),
  unit: z.string(),
});

const sourceTypeSchema = z.enum(["issuerConfirmed", "ownerObserved", "inferred"]);

const fxRuleSchema = annotatedObject({
  status: z.enum(["current", "announced"]),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  announcedAt: z.string().optional(),
  rate: z.number(),
  freeAllowanceCadPerCalendarMonth: z.number().optional(),
  postAllowanceRate: z.number().optional(),
  sourceType: sourceTypeSchema.optional(),
  lastVerifiedAt: z.string().optional(),
  sources: z.array(z.string()).optional(),
});

// earn is a union on `type`, matching Earn's custom Codable implementation —
// each variant is genuinely closed (no "_"-prefixed escape hatch here, per
// the JSON schema's earn $def).
const earnSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("points"), pointsPerCad: z.number() }),
  z.strictObject({
    type: z.literal("cashback"),
    rate: z.number(),
    rewardCurrency: z.string().nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("centsPerLitre"),
    premiumCentsPerLitre: z.number().optional(),
    otherCentsPerLitre: z.number().optional(),
  }),
]);

const predicateSchema = annotatedObject({
  categories: z.array(z.string()).optional(),
  mccInclude: z.array(z.number()).optional(),
  mccExclude: z.array(z.number()).optional(),
  merchantInclude: z.array(z.string()).optional(),
  merchantExclude: z.array(z.string()).optional(),
  country: z.string().optional(),
  currency: z.string().optional(),
  channels: z.array(z.string()).optional(),
  recurringViaNetworkIndicator: z.boolean().optional(),
});

const capSchema = annotatedObject({
  capId: z.string(),
  measure: z.enum(["spendCad", "spendUsdEquivalent"]),
  limit: z.number(),
  period: z.enum(["calendarMonth", "calendarYear", "accountYear"]),
  anchor: z.string().optional(),
  resetTimeZone: z.string(),
  postCapEarn: earnSchema.optional(),
  proration: z.boolean(),
});

const earnRuleSchema = annotatedObject({
  ruleId: z.string(),
  status: z.enum(["current", "announced"]),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  sourceType: sourceTypeSchema,
  lastVerifiedAt: z.string(),
  earn: earnSchema,
  predicate: predicateSchema,
  capId: z.string().nullable(),
  ownerConditions: z
    .array(z.enum(["rogersEligibleServiceLinked", "cryptoLevelUpProActive", "tangerineCategorySelected"]))
    .optional(),
  scoredInV1: z.boolean().optional(),
});

const cardProductSchema = annotatedObject({
  cardId: z.string(),
  officialName: z.string(),
  issuer: z.string(),
  network: z.enum(["amex", "visa", "mastercard"]),
  kind: z.enum(["credit", "charge", "prepaid"]),
  fee: feeSchema,
  program: programSchema,
  fxRules: z.array(fxRuleSchema),
  earnRules: z.array(earnRuleSchema),
  caps: z.array(capSchema),
  perTransactionRewardVisibility: z.string(),
  lastVerifiedAt: z.string(),
  sources: z.array(z.string()).optional(),
  stacking: z.string().optional(),
  categoryMccReference: z.record(z.string(), z.unknown()).optional(),
  redemption: z.record(z.string(), z.unknown()).optional(),
  redemptionFactors: z.array(z.unknown()).optional(),
});

export const cardCatalogueSchema = annotatedObject({
  catalogueVersion: z.string().regex(/^\d+\.\d+$/, "MAJOR.MINOR, e.g. 1.0"),
  currency: z.literal("CAD"),
  cards: z.array(cardProductSchema),
});

export type Earn = z.infer<typeof earnSchema>;
export type CardProduct = z.infer<typeof cardProductSchema>;
export type CardCatalogue = z.infer<typeof cardCatalogueSchema>;

export function parseCardCatalogue(data: unknown): CardCatalogue {
  return cardCatalogueSchema.parse(data);
}

// --- Benefits (hand-derived — see file header) ---------------------------

const benefitVerificationSchema = z.enum(["stub", "issuerPage", "certificateVerified"]);

// BenefitCoverage's fields are all optional Int?/Double? in Swift; typed
// fields exist only for what the comparison table sorts/displays (spec §4),
// everything conditional stays free text in conditions/exclusions below.
const benefitCoverageSchema = z.strictObject({
  windowDays: z.number().nullable().optional(),
  maxPerOccurrenceCad: z.number().nullable().optional(),
  maxAnnualCad: z.number().nullable().optional(),
  extraYears: z.number().nullable().optional(),
  maxOriginalWarrantyYears: z.number().nullable().optional(),
  maxCad: z.number().nullable().optional(),
  deductibleCad: z.number().nullable().optional(),
  delayHours: z.number().nullable().optional(),
  perDayCad: z.number().nullable().optional(),
  maxTripLengthDays: z.number().nullable().optional(),
  maxRentalDays: z.number().nullable().optional(),
  maxVehicleValueCad: z.number().nullable().optional(),
  ageLimit: z.number().nullable().optional(),
});

// `family`/`kind` are open strings in Swift (same idiom as
// PurchaseContext.category) — unknown values decode fine there, so this
// loader accepts any string rather than a closed enum.
const benefitSchema = z.strictObject({
  benefitId: z.string(),
  family: z.string(),
  kind: z.string(),
  coverage: benefitCoverageSchema,
  conditions: z.array(z.string()),
  exclusions: z.array(z.string()).optional(),
  certificateQuote: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const certificateProvenanceSchema = z.strictObject({
  underwriter: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  certificateDate: z.string().nullable().optional(),
  lastVerifiedAt: z.string().nullable().optional(),
  verificationStatus: benefitVerificationSchema,
});

const cardBenefitsSchema = z.strictObject({
  cardId: z.string(),
  certificate: certificateProvenanceSchema,
  benefits: z.array(benefitSchema),
});

const benefitsTriggersSchema = z.strictObject({
  bigTicketThresholdCad: z.number(),
  consumableCategories: z.array(z.string()),
});

export const benefitsCatalogueSchema = annotatedObject({
  benefitsCatalogueVersion: z.string(),
  triggers: benefitsTriggersSchema,
  cards: z.array(cardBenefitsSchema),
});

export type Benefit = z.infer<typeof benefitSchema>;
export type CardBenefits = z.infer<typeof cardBenefitsSchema>;
export type BenefitsCatalogue = z.infer<typeof benefitsCatalogueSchema>;

export function parseBenefitsCatalogue(data: unknown): BenefitsCatalogue {
  return benefitsCatalogueSchema.parse(data);
}

// --- Parsed singletons -----------------------------------------------------
// Importing this module validates the vendored contract immediately: a
// shape drift that scripts/sync-contracts.sh + the drift-check test somehow
// missed still fails loudly here, at import time, rather than at first use.

export const cardCatalogue: CardCatalogue = parseCardCatalogue(cardCatalogueRaw);
export const benefitsCatalogue: BenefitsCatalogue = parseBenefitsCatalogue(benefitsCatalogueRaw);
