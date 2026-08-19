import { describe, expect, it } from "vitest";
import type { SymbolQuote } from "@/lib/services/marketlens";
import { planPriceSync, priceAsOfDate } from "./priceSync";

const holding = (symbol: string, lastPriceMinor = 1000, priceCurrency: string | null = "USD") => ({
  id: `id-${symbol}`,
  symbol,
  lastPriceMinor,
  priceCurrency,
});

const quote = (over: Partial<SymbolQuote> & { symbol: string }): SymbolQuote => ({
  status: "FRESH",
  close: 100,
  currency: "USD",
  tradeDate: "2026-08-18",
  source: "YAHOO",
  keySource: "NONE",
  staleTradingDays: 0,
  reason: null,
  ...over,
});

describe("planPriceSync", () => {
  it("converts a priced quote to minor units with its currency and provenance", () => {
    const plan = planPriceSync([holding("AAPL")], [quote({ symbol: "AAPL", close: 310.03 })]);

    expect(plan.updates).toEqual([
      {
        id: "id-AAPL",
        symbol: "AAPL",
        lastPriceMinor: 31003,
        priceCurrency: "USD",
        priceSource: "YAHOO",
        priceStatus: "FRESH",
        tradeDate: "2026-08-18",
      },
    ]);
  });

  it("keeps the last-known price when a symbol is unavailable", () => {
    // A symbol we cannot price today is not a symbol that became worthless today.
    const plan = planPriceSync(
      [holding("ZZZZ", 4200)],
      [quote({ symbol: "ZZZZ", status: "UNAVAILABLE", close: null, currency: null })],
    );

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped).toEqual([{ symbol: "ZZZZ", reason: "unavailable" }]);
  });

  it("refuses a price with no currency", () => {
    // This is what keeps a null priceCurrency in the database meaning exactly one
    // thing — "a human typed this in" — so valuation can safely read it as the
    // account's currency.
    const plan = planPriceSync([holding("AAPL")], [quote({ symbol: "AAPL", currency: null })]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped).toEqual([{ symbol: "AAPL", reason: "no-currency" }]);
  });

  it("leaves a holding alone when the batch has no quote for it", () => {
    const plan = planPriceSync([holding("MSFT")], [quote({ symbol: "AAPL" })]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped).toEqual([{ symbol: "MSFT", reason: "no-quote" }]);
  });

  it("applies a stale price but carries the stale label with it", () => {
    const plan = planPriceSync(
      [holding("VFV.TO")],
      [quote({ symbol: "VFV.TO", status: "STALE", close: 189.7, currency: "CAD", tradeDate: "2026-08-11" })],
    );

    expect(plan.updates[0]).toMatchObject({ priceStatus: "STALE", priceCurrency: "CAD", lastPriceMinor: 18970 });
  });

  it("matches symbols case-insensitively", () => {
    const plan = planPriceSync([holding("vfv.to")], [quote({ symbol: "VFV.TO", close: 189.7, currency: "CAD" })]);

    expect(plan.updates).toHaveLength(1);
  });
});

describe("priceAsOfDate", () => {
  const now = new Date("2026-08-19T04:00:00.000Z");

  it("uses the session the price came from, not the moment it was fetched", () => {
    // Recording fetch time would make a week-old close look seconds old, hiding
    // exactly the staleness the label exists to expose.
    const asOf = priceAsOfDate(
      { id: "x", symbol: "A", lastPriceMinor: 1, priceCurrency: "USD", priceSource: "YAHOO", priceStatus: "STALE", tradeDate: "2026-08-11" },
      now,
    );

    expect(asOf.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  it("falls back to now only when no trade date was supplied", () => {
    const asOf = priceAsOfDate(
      { id: "x", symbol: "A", lastPriceMinor: 1, priceCurrency: "USD", priceSource: "YAHOO", priceStatus: "FRESH", tradeDate: "" },
      now,
    );

    expect(asOf).toBe(now);
  });
});
