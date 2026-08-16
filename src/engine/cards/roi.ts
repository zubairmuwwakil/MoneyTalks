import { recommend, type Pick, type PurchaseCtx } from "./picker";
import { effectiveAnnualFeeMinor, periodKeyFor, SPEND_CATEGORIES, type CardDef, type SpendCategory } from "./types";

export function cheatSheet(
  cards: CardDef[],
  today: string,
): Array<{ category: SpendCategory; best: Pick | null; runnerUp: Pick | null }> {
  return SPEND_CATEGORIES.map((category) => {
    const ctx: PurchaseCtx = {
      category,
      amexAccepted: true,
      foreign: category === "online_foreign",
      networkRestriction: category === "warehouse" ? "MASTERCARD" : null,
      today,
    };
    return { category, ...recommend(cards, ctx, []) };
  });
}

export interface RedeemedCredit {
  creditId: string;
  periodKey: string;
}

export function cardVerdict(
  card: CardDef,
  redeemed: RedeemedCredit[],
  rewardsEstimateMinor: number,
  isBestSomewhere: boolean,
  today: string,
): { realizedMinor: number; netMinor: number; verdict: "KEEP" | "DOWNGRADE" | "CANCEL_CANDIDATE" } {
  const creditValue = card.rewards.credits.reduce((sum, credit) => {
    const key = periodKeyFor(credit.period, today);
    const wasRedeemed = redeemed.some((r) => r.creditId === credit.id && r.periodKey === key);
    return sum + (wasRedeemed ? credit.valueMinor : 0);
  }, 0);

  const realizedMinor = creditValue + rewardsEstimateMinor;
  const effectiveAnnualFee = effectiveAnnualFeeMinor(card);
  const netMinor = realizedMinor - effectiveAnnualFee;
  const verdict =
    effectiveAnnualFee === 0 || netMinor >= 0
      ? "KEEP"
      : isBestSomewhere
        ? "DOWNGRADE"
        : "CANCEL_CANDIDATE";

  return { realizedMinor, netMinor, verdict };
}

export function isBestSomewhere(card: CardDef, cards: CardDef[], today: string): boolean {
  return cheatSheet(cards, today).some((row) => row.best?.cardId === card.id);
}
