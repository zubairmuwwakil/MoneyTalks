import { periodKeyFor, type CapUsage, type CardDef, type Network, type SpendCategory } from "./types";

export interface PurchaseCtx {
  category: SpendCategory;
  amexAccepted: boolean;
  foreign: boolean;
  networkRestriction: Network | null;
  today: string;
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

  const rate = card.rewards.categoryRates.find((r) => r.category === ctx.category);
  let multiplier = card.rewards.baseMultiplier;
  let capNote = "";

  if (rate) {
    const overCap =
      rate.capMinor !== undefined &&
      capUsage.some(
        (u) =>
          u.cardId === card.id &&
          u.category === ctx.category &&
          u.periodKey === periodKeyFor(rate.capWindow ?? "MONTH", ctx.today) &&
          u.usedMinor >= (rate.capMinor ?? 0),
      );
    if (overCap) {
      capNote = " (category cap reached - base rate)";
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
