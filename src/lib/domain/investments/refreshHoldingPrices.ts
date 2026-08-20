/**
 * Refreshes stored holding prices from MarketLens.
 *
 * Shared by the nightly cron and the per-account refresh button so both obey the
 * same rule: a refresh that learns nothing changes nothing.
 */

import type { PrismaClient } from "@prisma/client";
import { fetchQuotes, isMarketLensConfigured, type SymbolQuote } from "@/lib/services/marketlens";
import { readProviderKeys } from "@/lib/security/providerKeys";
import { planPriceSync, priceAsOfDate, type SkippedPrice } from "./priceSync";

export type RefreshOutcome = {
  ok: boolean;
  updated: number;
  skipped: SkippedPrice[];
  /** Prices proven fresh for MarketLens' expected exchange session in this request. */
  validatedHoldingIds: string[];
  /** Which providers actually served the prices, e.g. {"YAHOO": 4, "BINANCE": 2}. Surfaced so a
   *  user who supplied their own key can see whether it was used. */
  sources: Record<string, number>;
  reason?: "not-configured" | "no-holdings" | "fetch-failed";
};

/**
 * @param accountId when given, only that account's holdings; otherwise every
 *                  holding the user owns.
 */
export async function refreshHoldingPrices(
  prisma: PrismaClient,
  userId: string,
  options: { accountId?: string; timeoutMs?: number } = {},
): Promise<RefreshOutcome> {
  if (!isMarketLensConfigured()) {
    return { ok: false, updated: 0, skipped: [], validatedHoldingIds: [], sources: {}, reason: "not-configured" };
  }

  const holdings = await prisma.holding.findMany({
    where: {
      account: {
        userId,
        ...(options.accountId ? { id: options.accountId } : {}),
      },
    },
    select: {
      id: true,
      symbol: true,
      lastPriceMinor: true,
      priceCurrency: true,
      account: { select: { type: true } },
    },
  });

  if (holdings.length === 0) {
    return { ok: false, updated: 0, skipped: [], validatedHoldingIds: [], sources: {}, reason: "no-holdings" };
  }

  const providerKeys = await readProviderKeys(prisma, userId);
  const equityHoldings = holdings.filter((h) => h.account.type !== "CRYPTO");
  const cryptoHoldings = holdings.filter((h) => h.account.type === "CRYPTO");

  const equityQuotes: SymbolQuote[] = [];
  const cryptoQuotes: SymbolQuote[] = [];
  const validatedEquitySymbols = new Set<string>();
  const validatedCryptoSymbols = new Set<string>();
  const keySources = new Set<string>();

  if (equityHoldings.length > 0) {
    const equityBatch = await fetchQuotes(
      equityHoldings.map((h) => h.symbol),
      { assetClass: "EQUITY", providerKeys, timeoutMs: options.timeoutMs },
    );
    if (equityBatch) {
      equityQuotes.push(...equityBatch.quotes);
      if (equityBatch.expectedSession) {
        equityBatch.quotes.forEach((quote) => {
          if (quote.status === "FRESH" && quote.tradeDate === equityBatch.expectedSession) {
            validatedEquitySymbols.add(quote.symbol.toUpperCase());
          }
        });
      }
      equityBatch.quotes.forEach((q) => {
        if (q.keySource) keySources.add(q.keySource);
      });
    }
  }

  if (cryptoHoldings.length > 0) {
    const cryptoBatch = await fetchQuotes(
      cryptoHoldings.map((h) => h.symbol),
      { assetClass: "CRYPTO", providerKeys, timeoutMs: options.timeoutMs },
    );
    if (cryptoBatch) {
      cryptoQuotes.push(...cryptoBatch.quotes);
      if (cryptoBatch.expectedSession) {
        cryptoBatch.quotes.forEach((quote) => {
          if (quote.status === "FRESH" && quote.tradeDate === cryptoBatch.expectedSession) {
            validatedCryptoSymbols.add(quote.symbol.toUpperCase());
          }
        });
      }
      cryptoBatch.quotes.forEach((q) => {
        if (q.keySource) keySources.add(q.keySource);
      });
    }
  }

  // Nothing came back at all. Leave every stored price exactly as it was — the
  // same rule as the FX cron, where an empty fetch must not overwrite good data.
  if (equityQuotes.length === 0 && cryptoQuotes.length === 0) {
    return { ok: false, updated: 0, skipped: [], validatedHoldingIds: [], sources: {}, reason: "fetch-failed" };
  }

  const equityPlan = planPriceSync(equityHoldings, equityQuotes);
  const cryptoPlan = planPriceSync(cryptoHoldings, cryptoQuotes);
  const plan = {
    updates: [...equityPlan.updates, ...cryptoPlan.updates],
    skipped: [...equityPlan.skipped, ...cryptoPlan.skipped],
  };
  const now = new Date();
  const validatedHoldingIds = [
    ...equityPlan.updates
      .filter(
        (update) =>
          update.priceStatus === "FRESH" && validatedEquitySymbols.has(update.symbol.toUpperCase()),
      )
      .map((update) => update.id),
    ...cryptoPlan.updates
      .filter(
        (update) =>
          update.priceStatus === "FRESH" && validatedCryptoSymbols.has(update.symbol.toUpperCase()),
      )
      .map((update) => update.id),
  ];

  for (const update of plan.updates) {
    await prisma.holding.update({
      where: { id: update.id },
      data: {
        lastPriceMinor: update.lastPriceMinor,
        priceCurrency: update.priceCurrency,
        priceSource: update.priceSource,
        priceStatus: update.priceStatus,
        priceAsOf: priceAsOfDate(update, now),
      },
    });
  }

  const sources: Record<string, number> = {};
  for (const update of plan.updates) {
    sources[update.priceSource] = (sources[update.priceSource] ?? 0) + 1;
  }

  // Record whether the user's own key was actually spent, so a key that has
  // quietly stopped working is visible instead of looking healthy while an
  // unlicensed fallback serves everything.
  if (Object.keys(providerKeys).length > 0) {
    const used = keySources.has("USER");
    await prisma.providerCredential.updateMany({
      where: { userId },
      data: { lastUsedAt: now, lastStatus: used ? "USED" : "NOT_USED" },
    });
  }

  return {
    ok: plan.updates.length > 0,
    updated: plan.updates.length,
    skipped: plan.skipped,
    validatedHoldingIds,
    sources,
  };
}
