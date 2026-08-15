/**
 * Best-effort crypto price auto-fetch via CoinGecko's public simple/price
 * endpoint. Equity auto-fetch (Stooq) was planned but dropped: Stooq's CSV
 * endpoint now returns HTTP 404 with an HTML body instead of CSV, and its
 * other endpoints serve a JavaScript proof-of-work bot challenge. There is
 * no free, no-key, server-side equity quote source, so equities keep
 * manual entry — the existing STALE_DATA rule already nags about that.
 */

export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  DOGE: "dogecoin",
  LTC: "litecoin",
  XRP: "ripple",
};

/**
 * Extracts a price in the requested currency from a CoinGecko
 * simple/price payload, as minor units. Pure — no fetch, no clock — so it
 * can be unit tested against a fixture. Returns null on any shape it
 * doesn't recognize rather than throwing, since the caller treats a bad
 * payload the same as a failed fetch.
 */
export function parseCoinGecko(json: unknown, id: string, vs: string): number | null {
  if (typeof json !== "object" || json === null) return null;
  const entry = (json as Record<string, Record<string, unknown>>)[id];
  const price = Number(entry?.[vs]);
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price * 100);
}

/**
 * Thin network wrapper around CoinGecko's simple/price endpoint, batched:
 * one request covers every recognized symbol rather than one request per
 * holding. This matters on Vercel Hobby, where serverless functions are
 * capped at 10 seconds — a sequential per-holding loop with a 5s timeout
 * each can exceed that with just two unresolvable coins, killing the
 * function mid-loop after some holdings have been written but before the
 * redirect runs. A single batched request keeps the whole call under one
 * 5s timeout regardless of how many holdings the account has.
 *
 * Ids only ever come from the fixed `COINGECKO_IDS` map, never from raw
 * holding-symbol text, so the URL can't be built from unvalidated input.
 * A symbol not in the map is dropped before any request is built and
 * simply has no entry in the result — the caller treats a missing entry
 * as a failure, exactly like the single-symbol version did. Not unit
 * tested directly — `parseCoinGecko` above carries the coverage. Every
 * failure path (no recognized symbols, non-200, timeout, network error,
 * malformed JSON) returns `{}` rather than throwing.
 */
export async function fetchCryptoPricesMinor(
  symbols: string[],
  currency: string,
): Promise<Record<string, number>> {
  const vs = currency.toLowerCase();
  const recognized = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(
    (s) => COINGECKO_IDS[s] !== undefined,
  );
  if (recognized.length === 0) return {};
  const ids = Array.from(new Set(recognized.map((s) => COINGECKO_IDS[s])));

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=${vs}`,
      { signal: AbortSignal.timeout(5000), cache: "no-store" },
    );
    if (!res.ok) return {};
    const json = await res.json();
    const result: Record<string, number> = {};
    for (const symbol of recognized) {
      const price = parseCoinGecko(json, COINGECKO_IDS[symbol], vs);
      if (price !== null) result[symbol] = price;
    }
    return result;
  } catch {
    return {};
  }
}
