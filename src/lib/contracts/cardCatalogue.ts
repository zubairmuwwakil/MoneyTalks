import { z } from "zod";
import cardCatalogueRaw from "../../../contracts/card-catalogue.json";
import benefitsCatalogueRaw from "../../../contracts/benefits-catalogue.json";

/**
 * Zod mirror of PickMe's contracts/schema/card-catalogue.schema.json (spec:
 * ../PickMe/docs/plans/2026-08-16-card-contract-spec.md §4). Validated on
 * load — nothing here is cast from the raw JSON import's inferred shape.
 *
 * The benefits half below mirrors contracts/schema/benefits-catalogue.schema.json,
 * which PickMe authored after this loader was first written. The earlier
 * hand-derivation from BenefitsModels.swift is retired: that schema is now the
 * single authoritative reading of the format, so shape questions get settled
 * there rather than re-derived here from the data.
 *
 * Two of its rules are load-bearing and easy to get backwards. `family` and
 * `kind` are OPEN vocabularies — unknown values MUST parse, because Swift
 * decodes them as plain strings and simply ignores unrecognised ones, which is
 * how a newer writer's benefit kind stays readable by an older consumer.
 * `verificationStatus` is CLOSED — an unknown value is a hard decode failure in
 * Swift, so accepting one here would mask a real contract break.
 *
 * `program.programId` follows the same open-vocabulary rule as `family` /
 * `kind`: Swift's `Program.programId` is a plain `String`
 * (CatalogueModels.swift), not a closed enum, so a new loyalty program added
 * to PickMe's catalogue must stay readable here too. It was previously a
 * 6-value `z.enum`, which made every new programId a hard MoneyTalks build
 * break the moment PickMe's catalogue synced (discovered 2026-08-18 — see
 * docs/superpowers/specs/2026-08-18-annual-fee-renewal-calendar-design.md
 * §12.1).
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
  programId: z.string().min(1),
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
  ownerConditions: z.array(z.string()).optional(),
  scoredInV1: z.boolean().optional(),
});

// Statement credits granted for holding the card. Mirrors `$defs/cardCredit`
// in PickMe's schema, added 2026-08-19. A credit does not depend on what the
// purchase was, so it never enters the checkout pick — it is keep/cancel and
// net-value input. `valueCad` is the issuer's stated maximum, not a forecast
// of use; whether one was redeemed is owner activity (CardState).
const cardCreditSchema = annotatedObject({
  creditId: z.string(),
  label: z.string(),
  valueCad: z.number(),
  period: z.enum(["calendarMonth", "calendarYear", "accountYear"]),
  sourceType: sourceTypeSchema,
  lastVerifiedAt: z.string(),
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
  // Optional: absence means the card grants no credits, never "unknown".
  credits: z.array(cardCreditSchema).optional(),
  imageUrl: z.string().optional(),
});

export const cardCatalogueSchema = annotatedObject({
  catalogueVersion: z.string().regex(/^\d+\.\d+$/, "MAJOR.MINOR, e.g. 1.0"),
  currency: z.literal("CAD"),
  cards: z.array(cardProductSchema),
});

export type CardCredit = z.infer<typeof cardCreditSchema>;
export type Earn = z.infer<typeof earnSchema>;
export type CardProduct = z.infer<typeof cardProductSchema>;
export type CardCatalogue = z.infer<typeof cardCatalogueSchema>;

export function parseCardCatalogue(data: unknown): CardCatalogue {
  return cardCatalogueSchema.parse(data);
}

// --- Benefits (mirrors schema/benefits-catalogue.schema.json — see header) ---

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
// annotatedObject, not strictObject: the schema declares patternProperties
// "^_" here, so "_"-prefixed annotations are legal on a benefit.
const benefitSchema = annotatedObject({
  benefitId: z.string(),
  family: z.string(),
  kind: z.string(),
  coverage: benefitCoverageSchema,
  conditions: z.array(z.string()),
  // [String]? in Swift and ["array","null"] in the schema, so an explicit
  // null is valid — .optional() alone would reject it.
  exclusions: z.array(z.string()).nullable().optional(),
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

// annotatedObject for the same reason as benefitSchema: the schema allows
// "_"-prefixed annotations on a card entry.
const cardBenefitsSchema = annotatedObject({
  cardId: z.string(),
  certificate: certificateProvenanceSchema,
  benefits: z.array(benefitSchema),
});

const benefitsTriggersSchema = z.strictObject({
  bigTicketThresholdCad: z.number(),
  consumableCategories: z.array(z.string()),
});

export const benefitsCatalogueSchema = annotatedObject({
  // MAJOR.MINOR per spec §3, matching the schema's pattern. Enforced here even
  // though PickMe's SeedLoader does not gate on it — a three-part version like
  // the old "0.2.0" is a contract violation this loader should surface, not pass.
  benefitsCatalogueVersion: z.string().regex(/^\d+\.\d+$/),
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
