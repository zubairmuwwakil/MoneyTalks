/**
 * Client for MarketLens, the ecosystem's single owner of market data.
 *
 * This file makes HTTP calls and nothing else. It must never grow a price
 * provider, an indicator, or a fallback that fetches quotes from somewhere else:
 * market data has exactly one owner (E3/E4), and the failure that rule was
 * written against is precisely this — a hub re-implementing what another repo
 * already owns because reaching for `fetch` was quicker than making the call.
 *
 * Everything here is daily closing prices. Never call it real-time (A6).
 */

export type QuoteStatus = "FRESH" | "STALE" | "UNAVAILABLE";
export type KeySource = "USER" | "APP" | "NONE";
export type AssetClass = "EQUITY" | "CRYPTO";

export type SymbolQuote = {
  symbol: string;
  status: QuoteStatus;
  /** Null whenever status is UNAVAILABLE. Never substitute a zero. */
  close: number | null;
  /** ISO-4217, or null when no provider reported one. Null means this figure
   *  must not be added to any other figure. */
  currency: string | null;
  tradeDate: string | null;
  source: string | null;
  keySource: KeySource | null;
  staleTradingDays: number | null;
  reason: string | null;
};

export type QuoteBatch = {
  pricing: string;
  expectedSession: string | null;
  quotes: SymbolQuote[];
  truncated: string[];
};

/** MarketLens caps a request at 50 symbols; it reports the overflow rather than
 *  trimming silently, but chunking here means we never trigger that at all. */
const MAX_SYMBOLS_PER_REQUEST = 50;

/**
 * Matches the cron's budget so a manual refresh can survive a MarketLens cold
 * start instead of falsely reporting "unreachable". The button already shows a
 * spinner and disables itself, so the user knows something is happening. A true
 * failure (MarketLens actually down) takes 20 s instead of 8, but a false
 * failure on cold start is far worse UX than waiting a few extra seconds on a
 * real one.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export function isMarketLensConfigured(): boolean {
  return Boolean(process.env.MARKETLENS_BASE_URL?.trim() && process.env.MARKETLENS_API_KEY?.trim());
}

/**
 * Validates a payload into a QuoteBatch. Pure — no fetch, no clock — so the
 * contract with MarketLens is testable against a fixture.
 *
 * Rejects rather than repairs: a quote claiming FRESH with no price, or a price
 * that is not a finite number, is dropped. A malformed payload must not become a
 * confident number in someone's portfolio.
 */
export function parseQuoteBatch(json: unknown): QuoteBatch | null {
  if (typeof json !== "object" || json === null) return null;
  const raw = json as Record<string, unknown>;
  if (!Array.isArray(raw.quotes)) return null;

  const quotes: SymbolQuote[] = [];
  for (const entry of raw.quotes) {
    if (typeof entry !== "object" || entry === null) continue;
    const q = entry as Record<string, unknown>;
    const symbol = typeof q.symbol === "string" ? q.symbol.toUpperCase() : null;
    const status = q.status;
    if (!symbol || (status !== "FRESH" && status !== "STALE" && status !== "UNAVAILABLE")) continue;

    const close = typeof q.close === "number" && Number.isFinite(q.close) && q.close > 0 ? q.close : null;
    // A priced status with no usable price is a contradiction; treat it as unknown
    // rather than trusting half of it.
    const resolvedStatus: QuoteStatus = close === null ? "UNAVAILABLE" : status;

    quotes.push({
      symbol,
      status: resolvedStatus,
      close: resolvedStatus === "UNAVAILABLE" ? null : close,
      currency: typeof q.currency === "string" && q.currency.length === 3 ? q.currency.toUpperCase() : null,
      tradeDate: typeof q.tradeDate === "string" ? q.tradeDate : null,
      source: typeof q.source === "string" ? q.source : null,
      keySource:
        q.keySource === "USER" || q.keySource === "APP" || q.keySource === "NONE" ? q.keySource : null,
      staleTradingDays: typeof q.staleTradingDays === "number" ? q.staleTradingDays : null,
      reason: typeof q.reason === "string" ? q.reason : null,
    });
  }

  return {
    pricing: typeof raw.pricing === "string" ? raw.pricing : "daily-close",
    expectedSession: typeof raw.expectedSession === "string" ? raw.expectedSession : null,
    quotes,
    truncated: Array.isArray(raw.truncated) ? raw.truncated.filter((t): t is string => typeof t === "string") : [],
  };
}

/**
 * Serialises BYOK credentials into MarketLens' provider-key header.
 *
 * Exported for testing the encoding, never for logging: this string contains the
 * user's plaintext credential and must not reach a log line, an error message, or
 * a redirect query string.
 */
export function providerKeyHeader(providerKeys: Record<string, string>): string | null {
  const pairs = Object.entries(providerKeys)
    .filter(([provider, key]) => provider.trim() && key.trim())
    // A comma or '=' inside a key would corrupt the header for every other
    // provider in it, so such a key is dropped rather than allowed to garble.
    .filter(([, key]) => !key.includes(",") && !key.includes("="))
    .map(([provider, key]) => `${provider.trim().toUpperCase()}=${key.trim()}`);
  return pairs.length ? pairs.join(",") : null;
}

/**
 * Latest daily closes for the given symbols.
 *
 * Returns null when nothing could be fetched at all — missing configuration, a
 * non-200, a timeout, a malformed body. Null means "we learned nothing", and
 * every caller must respond by leaving stored prices untouched, exactly as the FX
 * cron leaves rates untouched on an empty fetch.
 */
export async function fetchQuotes(
  symbols: string[],
  options: { assetClass?: AssetClass; providerKeys?: Record<string, string>; timeoutMs?: number } = {},
): Promise<QuoteBatch | null> {
  const baseUrl = process.env.MARKETLENS_BASE_URL?.trim();
  const apiKey = process.env.MARKETLENS_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  if (unique.length === 0) return null;

  const headers: Record<string, string> = { "X-API-Key": apiKey };
  const keyHeader = options.providerKeys ? providerKeyHeader(options.providerKeys) : null;
  if (keyHeader) headers["X-Provider-Key"] = keyHeader;

  const merged: QuoteBatch = { pricing: "daily-close", expectedSession: null, quotes: [], truncated: [] };
  let anySucceeded = false;
  const assetClassParam = options.assetClass ? `&assetClass=${encodeURIComponent(options.assetClass)}` : "";

  for (let i = 0; i < unique.length; i += MAX_SYMBOLS_PER_REQUEST) {
    const chunk = unique.slice(i, i + MAX_SYMBOLS_PER_REQUEST);
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/quotes?symbols=${encodeURIComponent(chunk.join(","))}${assetClassParam}`;
    try {
      const res = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const parsed = parseQuoteBatch(await res.json());
      if (!parsed) continue;
      anySucceeded = true;
      merged.pricing = parsed.pricing;
      merged.expectedSession = merged.expectedSession ?? parsed.expectedSession;
      merged.quotes.push(...parsed.quotes);
      merged.truncated.push(...parsed.truncated);
    } catch {
      // Timeout, network error, or unparseable body. A partial batch is still
      // worth returning — the symbols in the failed chunk simply keep their
      // cached prices.
      continue;
    }
  }

  return anySucceeded ? merged : null;
}
