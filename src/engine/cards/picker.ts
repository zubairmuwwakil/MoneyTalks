import {
  activeCategoryRate,
  activeMerchantRate,
  capForRate,
  periodKeyFor,
  type CapUsage,
  type CardDef,
  type Network,
  type SpendCategory,
} from "./types";

export interface PurchaseCtx {
  category: SpendCategory;
  amexAccepted: boolean;
  foreign: boolean;
  networkRestriction: Network | null;
  today: string;
  merchantName?: string | null;
}

export interface Pick {
  cardId: string;
  nickname: string;
  pct: number;
  why: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function effectiveReturnPct(
  card: CardDef,
  ctx: PurchaseCtx,
  capUsage: CapUsage[],
): { pct: number; why: string } | null {
  if (ctx.networkRestriction && card.network !== ctx.networkRestriction) return null;
  if (!ctx.amexAccepted && card.network === "AMEX") return null;

  const merchantRate = activeMerchantRate(card.rewards, ctx.merchantName);
  const rate = activeCategoryRate(card.rewards, ctx.category);
  let multiplier = card.rewards.baseMultiplier;
  let capNote = "";

  if (merchantRate) {
    multiplier = merchantRate.multiplier;
  } else if (rate) {
    const cap = capForRate(card.rewards, rate);
    const overCap =
      cap !== undefined &&
      capUsage
        .filter(
          (usage) =>
            usage.cardId === card.id &&
            cap.categories.includes(usage.category) &&
            usage.periodKey === periodKeyFor(cap.capWindow, ctx.today),
        )
        .reduce((sum, usage) => sum + usage.usedMinor, 0) >= cap.capMinor;
    if (overCap) {
      capNote = ` (${cap?.label} cap reached - base rate)`;
    } else {
      multiplier = rate.multiplier;
    }
  }

  const gross = multiplier * card.rewards.pointValueCents;
  const fx = ctx.foreign ? card.rewards.fxFeePct : 0;
  const pct = gross - fx;

  const why =
    `${multiplier}x at ${card.rewards.pointValueCents}c/pt = ${round1(gross)}%` +
    (fx > 0 ? ` - ${fx}% FX` : "") +
    (merchantRate ? ` (${merchantRate.merchant} bonus)` : "") +
    capNote;

  return { pct, why };
}

export function recommend(
  cards: CardDef[],
  ctx: PurchaseCtx,
  capUsage: CapUsage[],
): { best: Pick | null; runnerUp: Pick | null } {
  const ranked = cards
    .map((card) => {
      const result = effectiveReturnPct(card, ctx, capUsage);
      return result === null
        ? null
        : { cardId: card.id, nickname: card.nickname, pct: result.pct, why: result.why };
    })
    .filter((p): p is Pick => p !== null)
    .sort((a, b) => b.pct - a.pct);

  return { best: ranked[0] ?? null, runnerUp: ranked[1] ?? null };
}
