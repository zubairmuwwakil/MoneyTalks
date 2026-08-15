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
}

export interface CardRewards {
  pointValueCents: number; // cents of value per point; 1 = plain cashback
  fxFeePct: number;
  baseMultiplier: number;
  categoryRates: CategoryRate[];
  credits: CardCredit[];
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
