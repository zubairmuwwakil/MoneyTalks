export type Network = 'amex' | 'visa' | 'mastercard';
export type CardKind = 'credit' | 'charge' | 'prepaid';
export type RuleStatus = 'current' | 'announced';
export type SourceType = 'issuerConfirmed' | 'ownerObserved' | 'inferred';

export type Earn = 
  | { type: 'points'; pointsPerCad: number }
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
  'cap.accountYear',
]);

export const KNOWN_ENGINE_CAPABILITIES: ReadonlySet<string> = new Set([
  'cap.calendarMonth', 'cap.calendarYear', 'cap.accountYear', 'cap.statementYear',
  'cap.globalGroup', 'predicate.merchantPartnerList', 'predicate.mccStrict',
  'earn.perLitre', 'earn.marginal',
]);

export type CapMeasure = 'spendCad' | 'spendUsdEquivalent';
export type CapPeriod = 'calendarMonth' | 'calendarYear' | 'accountYear';

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

export interface Fee {
  annualCad?: number;
  monthlyCad?: number;
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
  valueCad: number;
  period: CapPeriod;
  sourceType: SourceType;
  lastVerifiedAt: string;
  /** Documentation-only issuer provenance; Swift ignores this field. */
  sources: string[];
}

export interface CardProduct {
  cardId: string;
  officialName: string;
  issuer: string;
  network: Network;
  kind: CardKind;
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
  cryptoLevelUpProActive?: boolean;
  croHandling?: string; // "autoSell" | "hold" | undefined
  unsetFields?: string[];
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
  | ({ model: 'cro' } & CroValuation)
  | ({ model: 'cashback' } & CashBackValuation);

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
