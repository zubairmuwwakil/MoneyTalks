/**
 * Makes MarketLens' quote cache correct for the symbols this app is about to
 * read, and reports whether it succeeded.
 *
 * WHY THIS EXISTS — the shape of the bug it prevents.
 *
 * MarketLens answers quotes from a cache and fans out to its upstream provider
 * only on a miss. That fan-out is the expensive step, it runs under a deadline,
 * and it is slowest on a just-woken instance. Whoever triggers the first one of
 * the night pays for it — and the loser of that race is served a cached price
 * that is **indistinguishable from a fresh one**. Through 2026-08 the loser was
 * the nightly price cron, every night, and the portfolio sat one session stale
 * with no error at either end (docs/decisions/LOG.md 2026-08-27).
 *
 * So the expensive work is done here, deliberately, ahead of the read, where
 * there is time for it and where failing is visible.
 *
 * Scoped to our own symbols on purpose. MarketLens also has a global sweep, but
 * it lives behind /api/v1/admin/** and requires an ADMIN role this app's key does
 * not carry — and rightly so: it spends shared provider budget on the whole
 * demand set. Warming what we hold is a consumer operation and needs no
 * privilege beyond an ordinary quotes read.
 */

import type { PrismaClient } from "@prisma/client";
import { fetchQuotes, isMarketLensConfigured } from "@/lib/services/marketlens";

export type WarmupReport = {
  /** True when every symbol we asked about came back FRESH. */
  ok: boolean;
  symbols: number;
  fresh: number;
  stale: number;
  /**
   * Histogram of MarketLens' reasons for the symbols that are not fresh, e.g.
   * `{"provider_deadline_exceeded": 2}`. Its vocabulary — see QuoteService's
   * CAUSE_* constants in the marketdata repo, and the table in
   * docs/runbooks/nightly-valuation.md. Carry this into alerts: "nothing worked"
   * is not actionable, "provider_deadline_exceeded x2" names the knob to turn.
   */
  causes: Record<string, number>;
  reason?: "not-configured" | "no-symbols" | "unreachable";
};

const EMPTY = { ok: false, symbols: 0, fresh: 0, stale: 0, causes: {} } as const;

export async function warmQuoteCache(
  prisma: PrismaClient,
  options: { timeoutMs?: number } = {},
): Promise<WarmupReport> {
  if (!isMarketLensConfigured()) return { ...EMPTY, causes: {}, reason: "not-configured" };

  const holdings = await prisma.holding.findMany({
    select: { symbol: true, account: { select: { type: true } } },
  });

  // Asset class decides which provider MarketLens resolves, so the split has to
  // happen before the call, exactly as refreshHoldingPrices splits it.
  const equity = new Set<string>();
  const crypto = new Set<string>();
  for (const holding of holdings) {
    const symbol = holding.symbol.trim().toUpperCase();
    if (!symbol) continue;
    (holding.account.type === "CRYPTO" ? crypto : equity).add(symbol);
  }

  const total = equity.size + crypto.size;
  if (total === 0) return { ...EMPTY, ok: true, causes: {}, reason: "no-symbols" };

  let fresh = 0;
  let stale = 0;
  let reachedMarketLens = false;
  const causes: Record<string, number> = {};

  for (const [assetClass, symbols] of [
    ["EQUITY", equity],
    ["CRYPTO", crypto],
  ] as const) {
    if (symbols.size === 0) continue;
    const batch = await fetchQuotes([...symbols], {
      assetClass,
      refresh: true,
      timeoutMs: options.timeoutMs,
    });
    // Null means we learned nothing at all — not that the market is quiet.
    if (!batch) continue;
    reachedMarketLens = true;

    for (const quote of batch.quotes) {
      if (quote.status === "FRESH") {
        fresh += 1;
        continue;
      }
      stale += 1;
      if (quote.reason) causes[quote.reason] = (causes[quote.reason] ?? 0) + 1;
    }
  }

  if (!reachedMarketLens) {
    return { ...EMPTY, symbols: total, causes: {}, reason: "unreachable" };
  }

  return { ok: fresh === total, symbols: total, fresh, stale, causes };
}
