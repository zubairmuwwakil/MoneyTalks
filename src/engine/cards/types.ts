export type Network = "VISA" | "MASTERCARD" | "AMEX";

export const SPEND_CATEGORIES = [
  "groceries",
  "dining",
  "gas",
  "bills",
  "streaming",
  "travel",
  "warehouse",
  "home_improvement",
  "hotel",
  "online_foreign",
  "everything_else",
] as const;

export type SpendCategory = (typeof SPEND_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SpendCategory, string> = {
  groceries: "Groceries",
  dining: "Dining & delivery",
  gas: "Gas",
  bills: "Bills & utilities",
  streaming: "Streaming",
  travel: "Travel booking",
  warehouse: "Warehouse club",
  home_improvement: "Home improvement",
  hotel: "Hotel",
  online_foreign: "Online (foreign currency)",
  everything_else: "Everything else",
};

export interface CardCredit {
  id: string;
  label: string;
  valueMinor: number;
  period: "YEAR" | "MONTH";
}

export interface CategoryRate {
  category: SpendCategory;
  multiplier: number;
  capMinor?: number;
  capWindow?: "MONTH" | "YEAR";
  capGroupId?: string;
  requiresConditionId?: string;
}

export interface CapGroup {
  id: string;
  label: string;
  capMinor: number;
  capWindow: "MONTH" | "YEAR";
}

export interface CardCondition {
  id: string;
  label: string;
  enabled: boolean;
  annualFeeReductionMinor?: number;
}

export interface MerchantRate {
  id: string;
  merchant: string;
  multiplier: number;
  requiresConditionId?: string;
}

export interface CardRewards {
  pointValueCents: number; // cents of value per point; 1 = plain cashback
  fxFeePct: number;
  baseMultiplier: number;
  categoryRates: CategoryRate[];
  credits: CardCredit[];
  capGroups?: CapGroup[];
  conditions?: CardCondition[];
  merchantRates?: MerchantRate[];
}

export interface CardDef {
  id: string;
  nickname: string;
  network: Network;
  annualFeeMinor: number;
  rewards: CardRewards;
}

export interface CapUsage {
  cardId: string;
  category: SpendCategory;
  periodKey: string; // "2026-08" for MONTH windows, "2026" for YEAR windows
  usedMinor: number;
}

export function periodKeyFor(window: "MONTH" | "YEAR", today: string): string {
  return window === "MONTH" ? today.slice(0, 7) : today.slice(0, 4);
}

export function conditionIsEnabled(rewards: CardRewards, conditionId?: string): boolean {
  if (!conditionId) return true;
  return rewards.conditions?.some((condition) => condition.id === conditionId && condition.enabled) ?? false;
}

export function activeCategoryRate(rewards: CardRewards, category: SpendCategory): CategoryRate | undefined {
  return rewards.categoryRates.find(
    (rate) => rate.category === category && conditionIsEnabled(rewards, rate.requiresConditionId),
  );
}

export function activeMerchantRate(rewards: CardRewards, merchantName?: string | null): MerchantRate | undefined {
  if (!merchantName) return undefined;
  const normalizedMerchant = normalizeMerchantName(merchantName);
  return rewards.merchantRates?.find(
    (rate) =>
      rate.merchant.split(",").some((name) => normalizeMerchantName(name) === normalizedMerchant) &&
      conditionIsEnabled(rewards, rate.requiresConditionId),
  );
}

export interface ResolvedSpendCap {
  id: string;
  label: string;
  capMinor: number;
  capWindow: "MONTH" | "YEAR";
  categories: SpendCategory[];
}

export function capForRate(rewards: CardRewards, rate: CategoryRate): ResolvedSpendCap | undefined {
  if (rate.capGroupId) {
    const group = rewards.capGroups?.find((candidate) => candidate.id === rate.capGroupId);
    if (!group) return undefined;
    return {
      id: group.id,
      label: group.label,
      capMinor: group.capMinor,
      capWindow: group.capWindow,
      categories: rewards.categoryRates
        .filter((candidate) => candidate.capGroupId === group.id && conditionIsEnabled(rewards, candidate.requiresConditionId))
        .map((candidate) => candidate.category),
    };
  }

  if (rate.capMinor === undefined) return undefined;
  return {
    id: `category:${rate.category}`,
    label: CATEGORY_LABELS[rate.category],
    capMinor: rate.capMinor,
    capWindow: rate.capWindow ?? "MONTH",
    categories: [rate.category],
  };
}

export function effectiveAnnualFeeMinor(card: CardDef): number {
  const reduction = (card.rewards.conditions ?? []).reduce(
    (sum, condition) => sum + (condition.enabled ? (condition.annualFeeReductionMinor ?? 0) : 0),
    0,
  );
  return Math.max(0, card.annualFeeMinor - reduction);
}

function normalizeMerchantName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
