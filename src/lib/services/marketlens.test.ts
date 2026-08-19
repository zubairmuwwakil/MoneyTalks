import { describe, expect, it } from "vitest";
import { parseQuoteBatch, providerKeyHeader } from "./marketlens";

describe("parseQuoteBatch", () => {
  const batch = (quotes: unknown[]) => ({
    pricing: "daily-close",
    expectedSession: "2026-08-18",
    quotes,
    truncated: [],
  });

  it("keeps a well-formed priced quote", () => {
    const parsed = parseQuoteBatch(
      batch([
        {
          symbol: "vfv.to",
          status: "FRESH",
          close: 189.7,
          currency: "cad",
          tradeDate: "2026-08-18",
          source: "YAHOO",
          keySource: "NONE",
          staleTradingDays: 0,
          reason: null,
        },
      ]),
    );

    expect(parsed?.quotes[0]).toMatchObject({
      symbol: "VFV.TO",
      status: "FRESH",
      close: 189.7,
      currency: "CAD",
      keySource: "NONE",
    });
  });

  it("downgrades a priced status that carries no usable price", () => {
    // A payload claiming FRESH with a null close is self-contradictory. Trusting
    // half of it is how a fabricated number reaches a portfolio total.
    const parsed = parseQuoteBatch(batch([{ symbol: "AAPL", status: "FRESH", close: null, currency: "USD" }]));

    expect(parsed?.quotes[0].status).toBe("UNAVAILABLE");
    expect(parsed?.quotes[0].close).toBeNull();
  });

  it("rejects non-positive and non-finite prices rather than storing them", () => {
    const parsed = parseQuoteBatch(
      batch([
        { symbol: "A", status: "FRESH", close: 0, currency: "USD" },
        { symbol: "B", status: "FRESH", close: -5, currency: "USD" },
      ]),
    );

    expect(parsed?.quotes.every((q) => q.status === "UNAVAILABLE" && q.close === null)).toBe(true);
  });

  it("treats a malformed currency as unknown rather than guessing", () => {
    const parsed = parseQuoteBatch(batch([{ symbol: "A", status: "FRESH", close: 10, currency: "DOLLARS" }]));

    expect(parsed?.quotes[0].currency).toBeNull();
  });

  it("drops entries with no symbol or an unrecognized status", () => {
    const parsed = parseQuoteBatch(
      batch([{ status: "FRESH", close: 10 }, { symbol: "A", status: "PROBABLY", close: 10 }]),
    );

    expect(parsed?.quotes).toHaveLength(0);
  });

  it("returns null for a payload that is not a quote batch at all", () => {
    expect(parseQuoteBatch(null)).toBeNull();
    expect(parseQuoteBatch({ nope: true })).toBeNull();
    expect(parseQuoteBatch("<html>502 Bad Gateway</html>")).toBeNull();
  });
});

describe("providerKeyHeader", () => {
  it("encodes several providers", () => {
    expect(providerKeyHeader({ alphavantage: "abc", coingecko: "def" })).toBe("ALPHAVANTAGE=abc,COINGECKO=def");
  });

  it("drops a key containing a delimiter instead of corrupting the header", () => {
    // A comma or '=' inside one key would garble every other provider's key in
    // the same request.
    expect(providerKeyHeader({ ALPHAVANTAGE: "ab,cd", COINGECKO: "ok" })).toBe("COINGECKO=ok");
  });

  it("returns null when there is nothing to send", () => {
    expect(providerKeyHeader({})).toBeNull();
    expect(providerKeyHeader({ ALPHAVANTAGE: "   " })).toBeNull();
  });
});
