/**
 * Applies MarketLens quotes to stored holdings.
 *
 * The governing invariant (E4): portfolio valuation never hard-depends on a live
 * fetch. Every path here either improves what we know or changes nothing at all —
 * there is no path that degrades a stored price. That mirrors the FX cron rule,
 * where an empty fetch returns 502 and leaves existing rates untouched.
 */

import type { SymbolQuote } from "@/lib/services/marketlens";

export type StoredHolding = {
  id: string;
  symbol: string;
  lastPriceMinor: number;
  priceCurrency: string | null;
};

export type PriceUpdate = {
  id: string;
  symbol: string;
  lastPriceMinor: number;
  priceCurrency: string;
  priceSource: string;
  priceStatus: "FRESH" | "STALE";
  tradeDate: string;
};

export type SkippedPrice = {
  symbol: string;
  reason: "unavailable" | "no-currency" | "no-quote" | "unusable-price";
};

export type PriceSyncPlan = { updates: PriceUpdate[]; skipped: SkippedPrice[] };

/**
 * Decides what to write, without writing anything. Pure, so every refusal below
 * is testable rather than asserted in a comment.
 *
 * A quote is applied only when it carries a usable price AND a currency. The
 * currency requirement is what keeps a null `priceCurrency` in the database
 * meaning exactly one thing — "a human typed this in before we tracked
 * currencies" — instead of degrading into "some provider didn't say". Without it,
 * valuation could not safely treat null as the account's currency.
 */
export function planPriceSync(holdings: StoredHolding[], quotes: SymbolQuote[]): PriceSyncPlan {
  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const updates: PriceUpdate[] = [];
  const skipped: SkippedPrice[] = [];

  for (const holding of holdings) {
    const quote = bySymbol.get(holding.symbol.toUpperCase());
    if (!quote) {
      skipped.push({ symbol: holding.symbol, reason: "no-quote" });
      continue;
    }
    if (quote.status === "UNAVAILABLE" || quote.close === null) {
      // Fail closed: keep the last-known price rather than blanking it. A symbol
      // we cannot price today is not a symbol that became worthless today.
      skipped.push({ symbol: holding.symbol, reason: "unavailable" });
      continue;
    }
    if (!quote.currency) {
      skipped.push({ symbol: holding.symbol, reason: "no-currency" });
      continue;
    }

    const lastPriceMinor = Math.round(quote.close * 100);
    if (!Number.isSafeInteger(lastPriceMinor) || lastPriceMinor <= 0) {
      skipped.push({ symbol: holding.symbol, reason: "unusable-price" });
      continue;
    }

    updates.push({
      id: holding.id,
      symbol: holding.symbol,
      lastPriceMinor,
      priceCurrency: quote.currency,
      priceSource: quote.source ?? "MARKETLENS",
      priceStatus: quote.status,
      tradeDate: quote.tradeDate ?? "",
    });
  }

  return { updates, skipped };
}

/**
 * `priceAsOf` is the session the price is FROM, not the moment we fetched it.
 *
 * Recording fetch time would make a four-session-old close look like it was
 * captured seconds ago, which is exactly the staleness the label exists to
 * expose. Falls back to now only when the provider gave no trade date, which the
 * planner already treats as a degraded case.
 */
export function priceAsOfDate(update: PriceUpdate, now: Date): Date {
  if (!update.tradeDate) return now;
  const parsed = new Date(`${update.tradeDate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}
