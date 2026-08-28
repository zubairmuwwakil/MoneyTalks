/// The payment network a card runs on. `privateLabel` means it runs on NONE — a store card
/// honoured only by its own merchant. It is never in a purchase's `acceptedNetworks` default,
/// so a `privateLabel` card that forgot to declare `acceptance` is excluded everywhere rather
/// than recommended anywhere. Mirrors Swift's `Network`.
export type Network = 'amex' | 'visa' | 'mastercard' | 'discover' | 'privateLabel';

/// Whether a card is accepted by NETWORK or by MERCHANT. Kept a closed two-case union rather
/// than an optional merchant list, because an `openLoop` record would have to carry a
/// `merchants` list Scorer never reads. Mirrors Swift's `AcceptanceScope`.
export type AcceptanceScope = 'openLoop' | 'closedLoop';

/// How a card comes to be accepted at a till. Absent on a CardProduct means `openLoop` — every
/// card published before card-contracts@2.7 takes the identical path it always did.
export interface Acceptance {
  scope: AcceptanceScope;
  merchants: string[];
}
export type CardKind = 'credit' | 'charge' | 'prepaid';
export type RuleStatus = 'current' | 'announced';
export type SourceType = 'issuerConfirmed' | 'ownerObserved' | 'inferred';

/// The country a card product is sold in. NOT, by itself, an eligibility claim beyond "this is
/// the market the card is sold in" — see `Eligibility.residency` for the rare card sold in more
/// than one. Mirrors Swift's `Market`.
export type Market = 'CA' | 'US';

/// The two currencies this catalogue represents. Used for `CardProduct.billingCurrency` and
/// `Money`. Adding a third market's currency is a schema + engine change.
export type Currency = 'CAD' | 'USD';

/// A currency-tagged monetary figure. Replaces the old bare CAD-assuming numbers
/// (`Fee.annualCad`/`monthlyCad`, `CardCredit.valueCad`) — a price without a currency must never
/// be summed with one that has it (see `reportingCurrency.ts`).
export interface Money {
  amount: number;
  currency: Currency;
}

export type Earn =
  | { type: 'points'; pointsPerUnit: number }
  | { type: 'cashback'; rate: number; rewardCurrency?: string }
  | { type: 'centsPerLitre' };

export interface Predicate {
  categories?: string[];
  mccInclude?: number[];
  mccExclude?: number[];
  merchantInclude?: string[];
  merchantExclude?: string[];
  country?: string;
  currency?: string;
  channels?: string[];
  recurringViaNetworkIndicator?: boolean;
}

export interface EarnRule {
  ruleId: string;
  status: RuleStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceType: SourceType;
  earn: Earn;
  predicate: Predicate;
  capId?: string;
  ownerConditions?: string[];
  scoredInV1?: boolean;
  /// Engine capabilities this rule needs ("not yet"). Mirrors Swift's `[String]` — an
  /// unrecognised name must be a gating decision, never a decode failure.
  requires?: string[];
  /// Set when the rule will never be scored ("never"). Mutually exclusive with `requires`.
  outOfScope?: { reason: string };
}

/// Mirrors Swift's EngineCapability.supported. The rest are namable by rules so they can turn
/// themselves on when the capability ships; `predicate.channelIdentity` is deliberately absent
/// from the vocabulary entirely — online booking channels are permanently out of scope for an
/// at-the-register copilot, so those rules use `outOfScope`, not `requires`.
export const SUPPORTED_ENGINE_CAPABILITIES: ReadonlySet<string> = new Set([
  'cap.calendarMonth',
  'cap.calendarYear',
  'cap.calendarQuarter',
  'cap.accountYear',
  'predicate.ownerSelectedCategory',
]);

export const KNOWN_ENGINE_CAPABILITIES: ReadonlySet<string> = new Set([
  'cap.calendarMonth', 'cap.calendarYear', 'cap.calendarQuarter', 'cap.accountYear',
  'cap.statementYear', 'cap.globalGroup', 'predicate.merchantPartnerList',
  'predicate.mccStrict', 'predicate.ownerSelectedCategory', 'earn.perLitre', 'earn.marginal',
]);

/// `spendCad` renamed to `spendNative` in catalogue 2.0: the amount is measured in the CARD's own
/// `billingCurrency`, not CAD unconditionally. `spendUsdEquivalent` is unchanged.
export type CapMeasure = 'spendNative' | 'spendUsdEquivalent';
/// `calendarQuarter` added for US rotating-category cards — a shape this catalogue could not
/// previously express at all.
export type CapPeriod = 'calendarMonth' | 'calendarQuarter' | 'calendarYear' | 'accountYear';

export interface Cap {
  capId: string;
  measure: CapMeasure;
  limit: number;
  period: CapPeriod;
  anchor?: string;
  resetTimeZone: string;
  postCapEarn?: Earn;
  proration: boolean;
}

export interface FxRule {
  status: RuleStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
  rate: number;
  freeAllowanceCadPerCalendarMonth?: number;
  postAllowanceRate?: number;
}

/// `annualCad`/`monthlyCad: number` renamed to `annual`/`monthly: Money` in catalogue 2.0 — a US
/// card's fee is stated in USD, never converted to CAD at authoring time.
export interface Fee {
  annual?: Money;
  monthly?: Money;
  billing?: string;
  waiver?: string;
}

export interface Program {
  programId: string;
  unit: string;
}

/// Mirrors Swift's `CardCredit` (CatalogueModels.swift). A recurring statement
/// credit for holding the card. Deliberately NOT an earn rule: it does not
/// depend on what the purchase was, so `RecommendationEngine` never reads it
/// and the golden fixtures are unaffected by its presence. It is keep/cancel
/// and net-value input only.
export interface CardCredit {
  creditId: string;
  label: string;
  /// Renamed from `valueCad: number` in catalogue 2.0.
  value: Money;
  period: CapPeriod;
  sourceType: SourceType;
  lastVerifiedAt: string;
  /** Documentation-only issuer provenance; Swift ignores this field. */
  sources: string[];
}

/// Which market(s) a resident must be in to hold a card. Absent means "assume `[market]`".
export interface Eligibility {
  residency?: Market[];
}

/// `published` (absent decodes as this) is a checkout-eligible product that has cleared this
/// catalogue's issuer-confirmed sourcing bar (D3). `draft` is a research-grade record that has
/// not — `RecommendationEngine`/`PortfolioAnalyzer`-equivalents must refuse to score it even if
/// somehow owned. Mirrors Swift's `CardStatus`.
export type CardStatus = 'published' | 'draft';

export interface CardProduct {
  cardId: string;
  officialName: string;
  issuer: string;
  /// The country this product is sold in. Absent decodes as 'CA' — every pre-2.0 card is
  /// Canadian (see `catalogueCard.ts` for where the default is applied on decode).
  market: Market;
  /// The currency a purchase is measured in for THIS card's own earn rules and caps.
  /// Independent of `market`.
  billingCurrency: Currency;
  network: Network;
  /// Absent means `openLoop` — accepted wherever `network` is. A closed-loop store card
  /// declares its merchants here instead, and is guarded on those rather than on `network`.
  acceptance?: Acceptance;
  kind: CardKind;
  /// Absent decodes as 'published'.
  status?: CardStatus;
  eligibility?: Eligibility;
  fee: Fee;
  program: Program;
  fxRules: FxRule[];
  earnRules: EarnRule[];
  caps: Cap[];
  perTransactionRewardVisibility: string;
  lastVerifiedAt: string;
  /// Optional: absence means the card grants no credits, never "unknown".
  credits?: CardCredit[];
}

export interface Catalogue {
  catalogueVersion: string;
  currency: string;
  cards: CardProduct[];
}

export interface SwitchThreshold {
  minAdvantagePercentagePoints: number;
  minAdvantageCad: number;
  semantics: string; // "both" | "either"
}

export interface Carry {
  drawerCards: string[];
}

export interface CardState {
  capProgress?: Record<string, number>;
  scotiaAccountYearAnchorMonth?: number;
  selectedCategories?: string[];
  treatAsAllSelected?: boolean;
  thirdCategoryUnlocked?: boolean;
  nextChangeEffectiveDate?: string;
  rogersEligibleServiceLinked?: boolean;
  rogersAccountAnniversaryMonth?: number;
  feeWaiverActive?: boolean;
  /**
   * Owner-condition answers keyed by the catalogue's condition id. An absent key is unresolved;
   * `false` is an explicit "no". Read through `resolvedFlags` so legacy state stays compatible.
   */
  flags?: Record<string, boolean>;
  /**
   * Legacy mirrors retained for the migration. `resolvedFlags` folds these in before `flags`, so
   * an answer written by a newer client always wins over a stale named mirror.
   */
  cryptoLevelUpProActive?: boolean;
  croHandling?: string; // "autoSell" | "hold" | undefined
  unsetFields?: string[];
}

/**
 * Resolves owner-condition answers across the temporary dual representation. Legacy mirrors seed
 * the result and the newer dictionary deliberately overwrites them; this merge order is contract
 * behaviour, not an implementation detail.
 */
export function resolvedFlags(state: CardState): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  if (state.rogersEligibleServiceLinked !== undefined) {
    flags.rogersEligibleServiceLinked = state.rogersEligibleServiceLinked;
  }
  if (state.cryptoLevelUpProActive !== undefined) {
    flags.cryptoLevelUpProActive = state.cryptoLevelUpProActive;
  }
  return { ...flags, ...state.flags };
}

export interface PointValuation {
  centsPerPoint: number;
  floorCentsPerPoint?: number;
  aspirationalCentsPerPoint?: number;
  low?: number;
  high?: number;
  basis?: string;
}

export interface CtMoneyValuation {
  cadPerUnit: number;
  optionalUsabilityFactor: number;
  usabilityFactorApplied: boolean;
}

/// Merchant-locked store credit. Same arithmetic as CtMoneyValuation, deliberately a separate
/// model: `ctMoney` is a published name inside a digest-pinned release, so it is a fact about
/// data already in the world rather than an implementation detail free to be generalised. Two
/// things that compute alike but mean differently stay two things. See the Swift twin.
export interface MerchantCreditValuation {
  cadPerUnit: number;
  optionalUsabilityFactor: number;
  usabilityFactorApplied: boolean;
  /// Disclosure, not dispatch — Scorer never reads it.
  merchantScope: string[];
  basis?: string;
}

export interface CroValuation {
  model: string;
  faceValueFactorIfAutoSold: number;
  defaultHeldRiskFactor: number;
}

export interface CashBackValuation {
  cadPerDollar: number;
}

/// Mirrors Swift's `ProgramValuation` sum type, dispatched on a `model` discriminator rather
/// than on the program's NAME. The name-keyed switch this replaced could only value the six
/// programs it listed, so a program gaining a valuation still needed a code change — and every
/// program it did not list scored zero. That is how 11 of the corpus's 16 programs silently
/// ranked last here while Swift ranked them correctly.
export type ProgramValuation =
  | ({ model: 'points' } & PointValuation)
  | ({ model: 'ctMoney' } & CtMoneyValuation)
  | ({ model: 'merchantCredit' } & MerchantCreditValuation)
  | ({ model: 'cro' } & CroValuation)
  | ({ model: 'cashback' } & CashBackValuation)
  /// A card with no rewards programme — MBNA True Line, Capital One Guaranteed Secured. No
  /// number to configure: zero is not an assumption anyone could hold differently. It exists so
  /// the distinction valueCad has always drawn becomes expressible — a MISSING valuation returns
  /// null and the card is excluded, because "we do not know what this is worth" must never rank
  /// as "worth nothing"; this returns 0 and the card is scored, ranking last on merit.
  /// Mirrors Swift's NoRewardsValuation and Kotlin's.
  | ({ model: 'noRewards' } & NoRewardsValuation);

export interface NoRewardsValuation {
  basis?: string;
}

/// Catalogue-level default valuations (contracts/programs.json), merged BENEATH anything the
/// owner has declared. Without the merge this file would be data nothing reads.
export interface ProgramDefaults {
  programsVersion: string;
  defaults: Record<string, ProgramValuation>;
}

/// Owner-declared valuations carry no `model` discriminator — the shape predates it — so the
/// model is inferred from which fields are present. Deterministic, and it keeps OwnerState's
/// wire contract (and the /api/spine/owner-state validator) unchanged.
export function inferValuationModel(value: Record<string, unknown>): ProgramValuation | null {
  if (typeof value !== 'object' || value === null) return null;
  if ('model' in value && typeof value.model === 'string') {
    // programs.json entries, and owner `cro` which has always carried model: "reward-currency".
    if (value.model === 'reward-currency') return { ...(value as object), model: 'cro' } as ProgramValuation;
    return value as unknown as ProgramValuation;
  }
  if ('cadPerDollar' in value) return { ...(value as object), model: 'cashback' } as ProgramValuation;
  if ('cadPerUnit' in value) return { ...(value as object), model: 'ctMoney' } as ProgramValuation;
  if ('faceValueFactorIfAutoSold' in value) return { ...(value as object), model: 'cro' } as ProgramValuation;
  if ('centsPerPoint' in value) return { ...(value as object), model: 'points' } as ProgramValuation;
  return null;
}

export interface Valuations {
  amexMembershipRewards: PointValuation;
  marriottBonvoy: PointValuation;
  mbnaRewards: PointValuation;
  ctMoney: CtMoneyValuation;
  cro: CroValuation;
  cashBack: CashBackValuation;
  /// Programs beyond the six the owner declares by name — filled from catalogue defaults.
  [programId: string]: unknown;
}

export interface OwnerState {
  ownerStateVersion: string;
  ownedCardIds: string[];
  defaultCardId: string;
  switchThreshold: SwitchThreshold;
  carry: Carry;
  cardStates: Record<string, CardState>;
  valuationsCad: Valuations;
  /// The owner's own residency, as a raw `Market` string. Mirrors the Swift/Kotlin twins — see
  /// `OwnerState.market`'s doc comment there for why this defaults rather than refuses.
  market?: Market;
}

/// The owner's residency for market-scoping purposes, defaulting to 'CA' when unresolved.
export function resolvedMarket(ownerState: Pick<OwnerState, 'market'>): Market {
  return ownerState.market ?? 'CA';
}

export interface PurchaseContext {
  amountCad: number;
  currency: string;
  usdEquivalent?: number;
  category: string;
  mcc?: number;
  merchantBrand?: string;
  country?: string;
  channel?: string;
  recurringIndicator?: boolean;
  acceptedNetworks?: Network[];
}
