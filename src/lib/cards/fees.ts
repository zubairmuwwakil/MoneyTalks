import { periodKeyFor, type CardCredit, type CardDef } from "./types";

export interface RedeemedCredit {
  creditId: string;
  periodKey: string;
}

export function effectiveAnnualFeeMinor(card: CardDef): number {
  const reduction = (card.rewards.conditions ?? []).reduce(
    (sum, condition) => sum + (condition.enabled ? (condition.annualFeeReductionMinor ?? 0) : 0),
    0,
  );
  return Math.max(0, card.annualFeeMinor - reduction);
}

export function creditsRealizedMinor(credits: CardCredit[], redeemed: RedeemedCredit[], today: string): number {
  return credits.reduce((sum, credit) => {
    const key = periodKeyFor(credit.period, today);
    const wasRedeemed = redeemed.some((r) => r.creditId === credit.id && r.periodKey === key);
    return sum + (wasRedeemed ? credit.valueMinor : 0);
  }, 0);
}
