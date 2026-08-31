export type Network = "VISA" | "MASTERCARD" | "AMEX" | "DISCOVER";

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
