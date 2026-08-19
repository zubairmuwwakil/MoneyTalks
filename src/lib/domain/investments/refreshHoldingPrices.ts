/**
 * Refreshes stored holding prices from MarketLens.
 *
 * Shared by the nightly cron and the per-account refresh button so both obey the
 * same rule: a refresh that learns nothing changes nothing.
 */

import type { PrismaClient } from "@prisma/client";
import { fetchQuotes, isMarketLensConfigured } from "@/lib/services/marketlens";
import { readProviderKeys } from "@/lib/security/providerKeys";
import { planPriceSync, priceAsOfDate, type SkippedPrice } from "./priceSync";

export type RefreshOutcome = {
  ok: boolean;
  updated: number;
  skipped: SkippedPrice[];
  /** Which providers actually served the prices, e.g. {"YAHOO": 4}. Surfaced so a
   *  user who supplied their own key can see whether it was used. */
  sources: Record<string, number>;
  reason?: "not-configured" | "no-holdings" | "fetch-failed";
};

/**
 * @param accountId when given, only that account's holdings; otherwise every
 *                  holding the user owns.
 *
 * Crypto is excluded here on purpose: MarketLens is equities-only today, and the
 * hub's existing CoinGecko path still serves crypto until that capability is
 * ported. Sending BTC to an equities provider would produce an UNAVAILABLE that
 * looks like a failure rather than a boundary.
 */
export async function refreshHoldingPrices(
  prisma: PrismaClient,
  userId: string,
  options: { accountId?: string; timeoutMs?: number } = {},
): Promise<RefreshOutcome> {
  if (!isMarketLensConfigured()) {
    return { ok: false, updated: 0, skipped: [], sources: {}, reason: "not-configured" };
  }

  const holdings = await prisma.holding.findMany({
    where: {
      account: {
        userId,
        type: { not: "CRYPTO" },
        ...(options.accountId ? { id: options.accountId } : {}),
      },
    },
    select: { id: true, symbol: true, lastPriceMinor: true, priceCurrency: true },
  });

  if (holdings.length === 0) {
    return { ok: false, updated: 0, skipped: [], sources: {}, reason: "no-holdings" };
  }

  const providerKeys = await readProviderKeys(prisma, userId);
  const batch = await fetchQuotes(
    holdings.map((h) => h.symbol),
    { providerKeys, timeoutMs: options.timeoutMs },
  );

  // Nothing came back at all. Leave every stored price exactly as it was — the
  // same rule as the FX cron, where an empty fetch must not overwrite good data.
  if (!batch) {
    return { ok: false, updated: 0, skipped: [], sources: {}, reason: "fetch-failed" };
  }

  const plan = planPriceSync(holdings, batch.quotes);
  const now = new Date();

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
  const keySources = new Set(batch.quotes.map((q) => q.keySource).filter(Boolean));
  if (Object.keys(providerKeys).length > 0) {
    const used = keySources.has("USER");
    await prisma.providerCredential.updateMany({
      where: { userId },
      data: { lastUsedAt: now, lastStatus: used ? "USED" : "NOT_USED" },
    });
  }

  return { ok: plan.updates.length > 0, updated: plan.updates.length, skipped: plan.skipped, sources };
}
