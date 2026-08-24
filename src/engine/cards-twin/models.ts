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
}

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

export interface Valuations {
  amexMembershipRewards: PointValuation;
  marriottBonvoy: PointValuation;
  mbnaRewards: PointValuation;
  ctMoney: CtMoneyValuation;
  cro: CroValuation;
  cashBack: CashBackValuation;
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
