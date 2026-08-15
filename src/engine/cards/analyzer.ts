import { matchMerchantInDescription } from "./merchants";
import { effectiveReturnPct, recommend, type PurchaseCtx } from "./picker";
import type { CardDef, SpendCategory } from "./types";

const KEYWORDS: Array<[RegExp, SpendCategory]> = [
  [/supermarket|grocer|food mart|market/i, "groceries"],
  [/restaurant|pizza|sushi|coffee|cafe|burger|doordash|skip.?the.?dishes/i, "dining"],
  [/gas|petro|fuel|esso|shell/i, "gas"],
  [/netflix|spotify|disney|crave|prime video/i, "streaming"],
  [/hydro|utility|telecom|mobile|internet|insurance/i, "bills"],
  [/hotel|inn|resort/i, "hotel"],
  [/airline|air |flight|rail/i, "travel"],
];

/**
 * Ruling A: merchant matching for a statement line must check whether a
 * known merchant's name appears *inside* the description (statement lines
 * carry store numbers / order ids as noise around the brand), not whether
 * the description is contained in the merchant's name — that's the
 * picker's search-box direction (`matchMerchant`) and is backwards here.
 */
export function categorize(description: string): SpendCategory {
  const merchant = matchMerchantInDescription(description);
  if (merchant) return merchant.category;
  for (const [pattern, category] of KEYWORDS) {
    if (pattern.test(description)) return category;
  }
  return "everything_else";
}

/** Unrestricted acceptance context: what the USED card earned is historical fact — the statement proves it was accepted. */
function unrestrictedCtx(category: SpendCategory, today: string): PurchaseCtx {
  return { category, amexAccepted: true, foreign: false, networkRestriction: null, today };
}

/**
 * Ruling B: the BEST alternative must be computed in the merchant-derived
 * acceptance context, so a network-restricted or Amex-unfriendly merchant
 * can never be answered with a card it refuses. Falls back to the
 * unrestricted defaults when there's no merchant match.
 */
function merchantCtx(description: string, category: SpendCategory, today: string): PurchaseCtx {
  const fact = matchMerchantInDescription(description);
  return {
    category,
    amexAccepted: fact?.amexAccepted ?? true,
    foreign: false,
    networkRestriction: fact?.networkRestriction ?? null,
    today,
  };
}

interface CategoryAccumulator {
  category: SpendCategory;
  spendMinor: number;
  earnedMinor: number;
  optimalMinor: number;
  bestByCard: Map<string, { nickname: string; optimalMinor: number }>;
}

export function analyzeStatement(
  spend: Array<{ date: string; amountMinor: number; description: string }>,
  usedCard: CardDef,
  wallet: CardDef[],
  today: string,
): {
  totalSpendMinor: number;
  earnedMinor: number;
  optimalMinor: number;
  missedMinor: number;
  byCategory: Array<{
    category: SpendCategory;
    spendMinor: number;
    earnedMinor: number;
    optimalMinor: number;
    bestCardNickname: string | null;
  }>;
} {
  const byCategory = new Map<SpendCategory, CategoryAccumulator>();

  let totalSpendMinor = 0;
  let earnedMinor = 0;
  let optimalMinor = 0;

  for (const row of spend) {
    if (row.amountMinor <= 0) continue; // refunds/credits
    const category = categorize(row.description);

    // Ruling B: used-card earnings are computed per row in the unrestricted
    // context (the statement is proof of acceptance); the best alternative
    // is computed per row in the merchant-derived context (it must never
    // name a card the merchant refuses).
    const usedPct = effectiveReturnPct(usedCard, unrestrictedCtx(category, today), [])?.pct ?? 0;
    const ctx = merchantCtx(row.description, category, today);
    const best = recommend(wallet, ctx, []).best;
    const bestPct = best?.pct ?? 0;

    const earned = Math.round((row.amountMinor * usedPct) / 100);
    const optimal = Math.round((row.amountMinor * Math.max(bestPct, usedPct)) / 100);

    totalSpendMinor += row.amountMinor;
    earnedMinor += earned;
    optimalMinor += optimal;

    let acc = byCategory.get(category);
    if (!acc) {
      acc = { category, spendMinor: 0, earnedMinor: 0, optimalMinor: 0, bestByCard: new Map() };
      byCategory.set(category, acc);
    }
    acc.spendMinor += row.amountMinor;
    acc.earnedMinor += earned;
    acc.optimalMinor += optimal;

    // Attribute this row's optimal amount to whichever card earned it —
    // the used card when it matched or beat the best alternative,
    // otherwise the best alternative — so bestCardNickname reflects the
    // card contributing the largest optimal amount across the category.
    const contributorId = bestPct > usedPct && best ? best.cardId : usedCard.id;
    const contributorNickname = bestPct > usedPct && best ? best.nickname : usedCard.nickname;
    const prior = acc.bestByCard.get(contributorId);
    acc.bestByCard.set(contributorId, {
      nickname: contributorNickname,
      optimalMinor: (prior?.optimalMinor ?? 0) + optimal,
    });
  }

  const byCategoryRows = [...byCategory.values()]
    .map((acc) => {
      let bestCardNickname: string | null = null;
      let bestAmount = -1;
      for (const { nickname, optimalMinor: amount } of acc.bestByCard.values()) {
        if (amount > bestAmount) {
          bestAmount = amount;
          bestCardNickname = nickname;
        }
      }
      return {
        category: acc.category,
        spendMinor: acc.spendMinor,
        earnedMinor: acc.earnedMinor,
        optimalMinor: acc.optimalMinor,
        bestCardNickname,
      };
    })
    .sort((a, b) => b.spendMinor - a.spendMinor);

  return {
    totalSpendMinor,
    earnedMinor,
    optimalMinor,
    missedMinor: optimalMinor - earnedMinor,
    byCategory: byCategoryRows,
  };
}
