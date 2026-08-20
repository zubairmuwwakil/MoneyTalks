import { cardCatalogue, type CardCredit, type CardProduct } from "@/lib/contracts/cardCatalogue";
import type { Network } from "./types";

/**
 * Card semantics read from PickMe's catalogue, keyed by `CreditCard.contractCardId`.
 *
 * This module replaced `src/lib/cards/presets.ts` + `CreditCard.rewards`, which
 * were a second, hand-authored rate model for the same 27 cards — weaker than
 * the catalogue (no MCC, country, channel, accountYear caps, postCapEarn, FX
 * allowances or effective-dating) and carrying no issuer provenance. See
 * docs/superpowers/specs/2026-08-19-card-identity-collapse-design.md.
 *
 * The split this file enforces: the catalogue says what the CARD is; the
 * `CreditCard` row says what YOUR COPY of it is (nickname, limit, statement
 * day, the fee you actually pay). Nothing rate-shaped is ever stored per user.
 */

const CARDS_BY_ID = new Map<string, CardProduct>(cardCatalogue.cards.map((card) => [card.cardId, card]));

const NETWORK_TO_DB: Record<CardProduct["network"], Network> = {
  amex: "AMEX",
  visa: "VISA",
  mastercard: "MASTERCARD",
};

/// Null for a legacy or unlinked row. That is a real state, not an error: the
/// card exists and the UI asks the user to link it rather than guessing which
/// product it is — a wrong auto-match would silently rescore their spend.
export function catalogueCard(contractCardId: string | null | undefined): CardProduct | null {
  if (!contractCardId) return null;
  return CARDS_BY_ID.get(contractCardId) ?? null;
}

/// Absence of credits means the card grants none — never "unknown".
export function catalogueCredits(contractCardId: string | null | undefined): CardCredit[] {
  return catalogueCard(contractCardId)?.credits ?? [];
}

/// The issuer's own words about a fee waiver, where there are any. Shown
/// instead of a number because issuers offer tiers: the catalogue records that
/// Scotia's Ultimate package can rebate up to $150 while Preferred rebates $40,
/// and flattening that to one figure — as the retired preset model did — states
/// something the issuer does not.
export function feeWaiverNote(contractCardId: string | null | undefined): string | null {
  return catalogueCard(contractCardId)?.fee.waiver ?? null;
}

function periodKeyFor(period: CardCredit["period"], today: string): string {
  return period === "calendarMonth" ? today.slice(0, 7) : today.slice(0, 4);
}

export interface RedeemedCredit {
  creditId: string;
  periodKey: string;
}

/// Credits count only once the owner says they used them. An unredeemed credit
/// is worth nothing to a net-value figure, and assuming otherwise would inflate
/// every premium card's standing against the fee it charges.
export function catalogueCreditsRealizedMinor(
  credits: CardCredit[],
  redeemed: RedeemedCredit[],
  today: string,
): number {
  return credits.reduce((sum, credit) => {
    const key = periodKeyFor(credit.period, today);
    const wasRedeemed = redeemed.some((r) => r.creditId === credit.creditId && r.periodKey === key);
    // Math.round, not truncation: 14.99 * 100 is 1498.9999... in binary float,
    // and a monthly credit that quietly loses a cent every month is a bug that
    // only shows up in a yearly total.
    return sum + (wasRedeemed ? Math.round(credit.valueCad * 100) : 0);
  }, 0);
}

/// The fee the owner actually pays. The rebate is the OWNER's fact — what their
/// bank package actually gives them — not a property of the card, which is why
/// it lives on `CreditCard` and not in the catalogue.
export function effectiveAnnualFeeMinor(annualFeeMinor: number, feeRebateMinor: number): number {
  return Math.max(0, annualFeeMinor - feeRebateMinor);
}

export interface CatalogueChoice {
  contractCardId: string;
  officialName: string;
  issuer: string;
  network: Network;
  annualFeeMinor: number;
}

/// The add-card picker's options. Deliberately carries identity and fee only —
/// no rates, caps or multipliers are ever copied onto a user's row, because
/// copying them is precisely how the two rate models diverged in the first place.
export function catalogueChoices(): CatalogueChoice[] {
  return cardCatalogue.cards
    .map((card) => ({
      contractCardId: card.cardId,
      officialName: card.officialName,
      issuer: card.issuer,
      network: NETWORK_TO_DB[card.network],
      annualFeeMinor: Math.round((card.fee.annualCad ?? 0) * 100),
    }))
    .sort((a, b) =>
      a.issuer === b.issuer ? a.officialName.localeCompare(b.officialName) : a.issuer.localeCompare(b.issuer),
    );
}
