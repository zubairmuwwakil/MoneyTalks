export type Network = "VISA" | "MASTERCARD" | "AMEX";

// The hub's own spend vocabulary. This is NOT the card rate model — that lives
// in PickMe's catalogue and is read through src/lib/cards/catalogueCard.ts.
// These categories exist so a MerchantAlias can be classified (see
// /settings/merchants), which is hub-owned, global, shared learning.
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

/**
 * A user's own copy of a card — the facts the hub owns. Everything rate-shaped
 * (earn rules, caps, FX, credits) is resolved from the catalogue via
 * `contractCardId`; nothing of the sort is ever stored per user.
 *
 * `contractCardId` null means the row is legacy or was imported, so its rates
 * are simply unknown until the owner links it. That is deliberately not an
 * error state and never a guess — see catalogueCard.ts.
 */
export interface CardDef {
  id: string;
  nickname: string;
  network: Network;
  annualFeeMinor: number;
  feeRebateMinor: number;
  contractCardId: string | null;
}
