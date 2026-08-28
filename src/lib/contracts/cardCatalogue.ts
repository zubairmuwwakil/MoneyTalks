import { z } from "zod";
import cardCatalogueRaw from "../../../contracts/card-catalogue.json";
import benefitsCatalogueRaw from "../../../contracts/benefits-catalogue.json";
import programsRaw from "../../../contracts/programs.json";

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

// A currency-tagged monetary figure. Replaces the old bare CAD-assuming numbers
// (fee.annualCad/monthlyCad, cardCredit.valueCad) as of catalogue 2.0 — a US card's fee/credit is
// stated in USD, never converted to CAD at authoring time (Phase 1: never convert a USD amount
// into a CAD-labelled field merely to satisfy the schema).
const moneySchema = z.strictObject({
  amount: z.number(),
  currency: z.enum(["CAD", "USD"]),
});

const feeSchema = annotatedObject({
  annual: moneySchema.optional(),
  monthly: moneySchema.optional(),
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
  z.strictObject({ type: z.literal("points"), pointsPerUnit: z.number() }),
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
  // spendCad renamed to spendNative in catalogue 2.0: measured in the card's own
  // billingCurrency, not CAD unconditionally.
  measure: z.enum(["spendNative", "spendUsdEquivalent"]),
  limit: z.number(),
  // calendarQuarter added for US rotating-category cards (e.g. 5x groceries up to $1,500/quarter)
  // — a shape this catalogue could not previously express at all.
  period: z.enum(["calendarMonth", "calendarQuarter", "calendarYear", "accountYear"]),
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
  // Engine capabilities the rule waits on ("not yet"). Deliberately z.string() and NOT a closed
  // enum, mirroring Swift's `[String]`: an unrecognised capability name must be a gating decision
  // made in code, never a decode failure that loses the whole catalogue. This is the same lesson
  // `program.programId` cost us on 2026-08-18 — a closed enum here makes every capability PickMe
  // adds a hard MoneyTalks build break the moment the catalogue syncs.
  requires: z.array(z.string()).optional(),
  // Set when the rule will never be scored ("never"), as distinct from `requires`. Mutually
  // exclusive with it; PickMe's CapabilityGatingTests enforces that, so it is not re-checked here.
  outOfScope: annotatedObject({ reason: z.string() }).optional(),
});

// Statement credits granted for holding the card. Mirrors `$defs/cardCredit`
// in PickMe's schema, added 2026-08-19. A credit does not depend on what the
// purchase was, so it never enters the checkout pick — it is keep/cancel and
// net-value input. `value` (renamed from `valueCad: number` in catalogue 2.0, now Money) is the
// issuer's stated maximum, not a forecast of use; whether one was redeemed is owner activity
// (CardState).
const cardCreditSchema = annotatedObject({
  creditId: z.string(),
  label: z.string(),
  value: moneySchema,
  period: z.enum(["calendarMonth", "calendarQuarter", "calendarYear", "accountYear"]),
  sourceType: sourceTypeSchema,
  lastVerifiedAt: z.string(),
  // Traceability, conditioned on the claim being made. `sources` was briefly
  // required unconditionally, which is a stronger rule than intended: it makes
  // an honestly-labelled `inferred` credit impossible to express, so the only
  // ways to satisfy it are to delete unverified data or to invent a citation
  // for it. Both are worse than saying "we have not checked this".
  sources: z.array(z.string().url()).min(1).optional(),
}).superRefine((credit, ctx) => {
  // The invariant that actually matters: a credit claiming issuer confirmation
  // must be traceable to the issuer. Anything weaker may stand uncited, because
  // its sourceType already says so.
  if (credit.sourceType === "issuerConfirmed" && !credit.sources?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["sources"],
      message: `credit ${credit.creditId} is issuerConfirmed but cites no source`,
    });
  }
});

// Which market(s) a resident must be in to hold a card. Absent means "assume [market]".
const eligibilitySchema = annotatedObject({
  residency: z.array(z.enum(["CA", "US"])).min(1).optional(),
  incomeRequirementCad: z.number().optional(),
  creditScoreTier: z.string().optional(),
  provinceStateRestriction: z.array(z.string()).optional(),
  businessOnly: z.boolean().optional(),
});

const cardProductSchema = annotatedObject({
  cardId: z.string(),
  officialName: z.string(),
  issuer: z.string(),
  // The country this product is sold in. NOT itself a currency claim (see billingCurrency) or,
  // by itself, an eligibility claim beyond "this is the market the card is sold in" (see
  // eligibility.residency for the rare card sold in more than one).
  market: z.enum(["CA", "US"]),
  // The currency a purchase is measured in for THIS card's own earn rules and caps. Independent
  // of market: a CA-market card could in principle bill in USD (none do today).
  billingCurrency: z.enum(["CAD", "USD"]),
  network: z.enum(["amex", "visa", "mastercard", "discover"]),
  kind: z.enum(["credit", "charge", "prepaid"]),
  // Absent decodes as "published" — backward compatible with every pre-2.0 card. "draft" is a
  // research-grade record that has not cleared this catalogue's issuer-confirmed sourcing bar
  // (D3); PickMe's engine refuses to score one even if it somehow ended up owned.
  status: z.enum(["published", "draft"]).optional(),
  // Absent means "active". Independent of `status`: a published card can later be withdrawn.
  // PickMe's engine excludes a withdrawn card from scoring only for an asOf after `effectiveTo`
  // — the twin does not yet mirror that exclusion (no fixture exercises it), but the schema must
  // still accept the field or a future catalogue sync with a withdrawn card fails closed here.
  lifecycleStatus: z.enum(["active", "withdrawn"]).optional(),
  effectiveTo: z.string().optional(),
  eligibility: eligibilitySchema.optional(),
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
// shape drift that scripts/sync/sync-contracts.sh + the drift-check test somehow
// missed still fails loudly here, at import time, rather than at first use.

export const cardCatalogue: CardCatalogue = parseCardCatalogue(cardCatalogueRaw);
export const benefitsCatalogue: BenefitsCatalogue = parseBenefitsCatalogue(benefitsCatalogueRaw);

/**
 * Has this product cleared D3's issuer-confirmed sourcing bar?
 *
 * Absent `status` means published — every pre-2.0 card, and the reason this reads defensively
 * rather than comparing to "draft": a value nobody has seen yet must not read as verified.
 */
export function isPublished(card: Pick<CardProduct, "status">): boolean {
  return (card.status ?? "published") === "published";
}

/**
 * THE list of cards any user-facing surface may offer, and the id set any input may accept.
 *
 * Read this instead of `cardCatalogue.cards` anywhere the result reaches a person or validates
 * their input. `cardCatalogue.cards` is the whole corpus including `draft` records, which have
 * NOT been verified against the issuer.
 *
 * Why a shared helper rather than a filter at each call site: catalogue 2.2 added 26 US drafts
 * and four separate surfaces offered them immediately — the card picker, wallet settings' link
 * list, the reconcile picker, and the unmapped-purchase picker — plus two server actions that
 * would have accepted one as a link target. Only the first was caught, and only because a test
 * asserted a hardcoded count. `Scorer` already refuses to score a draft, but that guarantee
 * lives at exactly one chokepoint in the engine and does not propagate up into presentation;
 * this is the matching chokepoint for everything above it.
 *
 * Deliberately NOT market-filtered: which markets an owner should see is a per-surface question
 * (their own market, a market they are shopping in), and answering it here would hide a
 * legitimately cross-market card. Filter market at the call site, on top of this.
 */
export function publishedCards(): CardProduct[] {
  return cardCatalogue.cards.filter(isPublished);
}

/**
 * The complete catalogue for an explicitly unverified-aware browse surface.
 *
 * This is deliberately narrower than a replacement for `publishedCards()`:
 * only a surface which both labels drafts and scopes by owner-selected market
 * may call it. Validators, wallet links, recommendations, and analytics must
 * continue to use `publishedCards()` or their engine guard.
 */
export function browsableCards(): CardProduct[] {
  return cardCatalogue.cards;
}

/**
 * Catalogue-level default program valuations (contracts/programs.json), merged BENEATH whatever
 * the owner has declared. Nothing read this file until 2026-08-24, so 11 of the corpus's 16
 * programs were valued at nothing here while Swift valued them correctly — cards in those
 * programs silently lost every recommendation they should have won.
 *
 * `model` is an OPEN vocabulary for the same reason `programId` is: Swift decodes an unknown
 * model as a decode failure for that ENTRY, not for the file, and a new valuation model must not
 * become a hard MoneyTalks build break the moment the catalogue syncs.
 */
// Open by design (`catchall`), unlike every other schema in this file. A valuation entry carries
// fields specific to its model — `cro` alone has `redemptionModel` — and the set grows whenever a
// new model appears. `model` is what must be present; the rest is the model's own business, read
// by Scorer.valueCad at use time. Closing this cost one build break within minutes of writing it.
const programValuationSchema = z
  .object({ model: z.string(), basis: z.string().optional() })
  .catchall(z.unknown());

export const programDefaultsSchema = annotatedObject({
  programsVersion: z.string(),
  defaults: z.record(z.string(), programValuationSchema),
});

export const programDefaults = programDefaultsSchema.parse(programsRaw).defaults;
