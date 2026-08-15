import type { TxTypeName } from "../balance";
import type { FxRateInput } from "../fx";
import type { Currency } from "../money";

export type Severity = "info" | "warning" | "critical";
export type RuleKind = "compliance" | "opportunity";

export interface RuleAlert {
  ruleKey: string;
  severity: Severity;
  kind: RuleKind;
  entityRef: string; // "" = whole rule
  title: string;
  message: string;
  action: string;
  citation: string;
  valueMinor?: number;
  valueCurrency?: Currency;
}

export interface HoldingView {
  id: string;
  symbol: string;
  name: string;
  domicileCountry: string;
  quantity: number;
  bookCostMinor: number | null;
  lastPriceMinor: number;
  priceAsOf: string;
}

export interface TxView {
  id: string;
  type: TxTypeName;
  amountMinor: number;
  currency: string;
  date: string;
}

export interface AccountView {
  id: string;
  type: string;
  name: string;
  institution: string;
  country: string;
  currency: Currency;
  isUSSitus: boolean;
  balanceMinor: number;
  balanceAsOf: string | null;
  holdings: HoldingView[];
  transactions: TxView[];
  snapshots: Array<{ balanceMinor: number; asOf: string }>;
}

export type IncomeCadence = "MONTHLY" | "BIWEEKLY" | "ANNUAL";
export type IncomeKind = "EMPLOYMENT" | "SELF_EMPLOYMENT" | "BENEFIT" | "RENTAL" | "OTHER";

export interface IncomeSource {
  name: string;
  amountMinor: number;
  cadence: IncomeCadence;
  kind: IncomeKind;
}

export interface ProfileView {
  residency: string;
  citizenships: string[];
  filingStatus: "SINGLE_ABROAD" | "MFJ_ABROAD" | "OTHER";
  marginalUSRatePct: number;
  dtcEligible: boolean;
  benefitPrograms: string[];
  rdspIncomeTier: "LOW" | "HIGH" | "UNKNOWN";
  rdspCarryForwardYears: number;
  rdspGrantsLifetimeMinor: number;
  rdspContribLifetimeMinor: number;
  tfsaRoomMinor: number;
  rrspRoomMinor: number;
  fhsaRoomMinor: number;
  nhtContributed: boolean;
  incomeSources: IncomeSource[];
}

export interface FinancialSnapshot {
  today: string; // ISO date — rules never call Date.now()
  accounts: AccountView[];
  fxRates: FxRateInput[];
}

export interface Rule {
  key: string;
  jurisdiction: "US" | "CA" | "JM" | "CROSS";
  kind: RuleKind;
  citation: string;
  lastReviewed: string;
  evaluate(profile: ProfileView, snapshot: FinancialSnapshot): RuleAlert[];
}

export function annualizeMinor(source: IncomeSource): number {
  switch (source.cadence) {
    case "MONTHLY":
      return source.amountMinor * 12;
    case "BIWEEKLY":
      return source.amountMinor * 26;
    case "ANNUAL":
      return source.amountMinor;
  }
}

export function monthlyMinor(source: IncomeSource): number {
  return Math.round(annualizeMinor(source) / 12);
}

export function currentYear(today: string): string {
  return today.slice(0, 4);
}

export function txsThisYear(account: AccountView, today: string, type?: TxTypeName): TxView[] {
  const year = currentYear(today);
  return account.transactions.filter(
    (t) => t.date.slice(0, 4) === year && (type ? t.type === type : true),
  );
}
