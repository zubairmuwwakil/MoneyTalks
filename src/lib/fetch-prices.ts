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
 * Thin network wrapper around CoinGecko's simple/price endpoint. Not unit
 * tested directly — the parser above carries the coverage. Every failure
 * path (unknown symbol, non-200, timeout, network error, malformed JSON)
 * returns null; nothing here ever throws, so a caller can treat this
 * exactly like "no price available."
 */
export async function fetchCryptoPriceMinor(symbol: string, currency: string): Promise<number | null> {
  const id = COINGECKO_IDS[symbol.toUpperCase()];
  if (!id) return null;
  const vs = currency.toLowerCase();
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs}`,
      { signal: AbortSignal.timeout(5000), cache: "no-store" },
    );
    if (!res.ok) return null;
    return parseCoinGecko(await res.json(), id, vs);
  } catch {
    return null;
  }
}
