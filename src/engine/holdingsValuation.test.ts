import { describe, expect, it } from "vitest";
import { holdingsValuation } from "./balance";

const h = (symbol: string, quantity: number, lastPriceMinor: number, priceCurrency: string | null) => ({
  symbol,
  quantity,
  lastPriceMinor,
  priceCurrency,
});

describe("holdingsValuation", () => {
  it("totals holdings priced in the account's own currency", () => {
    const result = holdingsValuation([h("AAPL", 10, 31003, "USD"), h("MSFT", 2, 48163, "USD")], "USD");

    expect(result).toMatchObject({
      valueMinor: 310030 + 96326,
      currency: "USD",
      complete: true,
      excluded: [],
    });
  });

  it("excludes a holding priced in another currency instead of adding it", () => {
    // 189.70 CAD and 310.03 USD are not addable. A total that adds them is wrong
    // with no outward sign of being wrong.
    const result = holdingsValuation([h("AAPL", 10, 31003, "USD"), h("VFV.TO", 5, 18970, "CAD")], "USD");

    expect(result.valueMinor).toBe(310030);
    expect(result.complete).toBe(false);
    expect(result.excluded).toEqual([{ symbol: "VFV.TO", priceCurrency: "CAD", reason: "currency-mismatch" }]);
  });

  it("keeps valuing the rest of the account when one holding is foreign", () => {
    // Nine clean holdings and one foreign listing should still show nine.
    const result = holdingsValuation(
      [h("A", 1, 100, "USD"), h("B", 1, 200, "USD"), h("C", 1, 300, "EUR")],
      "USD",
    );

    expect(result.valueMinor).toBe(300);
    expect(result.excluded).toHaveLength(1);
  });

  it("counts a legacy price with no currency, but reports the assumption", () => {
    // Null means a human typed it into an account of that currency, which is what
    // the implicit convention actually was. Excluding it would break working data;
    // counting it silently would bury the assumption.
    const result = holdingsValuation([h("XEQT.TO", 10, 3000, null)], "CAD");

    expect(result.valueMinor).toBe(30000);
    expect(result.assumedCurrency).toEqual(["XEQT.TO"]);
    expect(result.complete).toBe(true);
  });

  it("compares currencies case-insensitively", () => {
    const result = holdingsValuation([h("AAPL", 1, 31003, "usd")], "USD");

    expect(result.excluded).toHaveLength(0);
    expect(result.valueMinor).toBe(31003);
  });

  it("returns a zero total with no holdings rather than failing", () => {
    expect(holdingsValuation([], "CAD")).toMatchObject({ valueMinor: 0, complete: true });
  });

  it("counts USD-pegged stablecoins in a USD account and reports the peg assumption", () => {
    const result = holdingsValuation(
      [h("BTC", 1, 6200000, "USDT"), h("ETH", 2, 300000, "USDC"), h("AAPL", 5, 22000, "USD")],
      "USD",
    );

    expect(result.valueMinor).toBe(6200000 + 600000 + 110000);
    expect(result.complete).toBe(true);
    expect(result.excluded).toHaveLength(0);
    expect(result.assumedPeg).toEqual(["BTC", "ETH"]);
  });

  it("converts foreign currency holdings when FX rates are supplied", () => {
    // 10 shares of TSLA at 336.87 USD (336870 cents USD) with USD/CAD rate 1.364 -> 459491 cents CAD
    const fxRates = [
      { base: "CAD" as const, quote: "USD" as const, rate: 0.7331, asOf: "2026-08-18T00:00:00Z" },
    ];

    const result = holdingsValuation(
      [h("TSLA", 10, 33687, "USD"), h("XEQT.TO", 100, 4571, "CAD")],
      "CAD",
      fxRates,
    );

    // 10 * 33687 = 336870 USD cents. USD to CAD: 336870 / 0.7331 = 459514
    // 100 * 4571 = 457100 CAD cents.
    // Total = 457100 + 459514 = 916614 CAD cents.
    expect(result.complete).toBe(true);
    expect(result.excluded).toHaveLength(0);
    expect(result.converted).toHaveLength(1);
    expect(result.converted[0]).toMatchObject({
      symbol: "TSLA",
      originalPriceCurrency: "USD",
      originalValueMinor: 336870,
    });
    expect(result.valueMinor).toBe(457100 + result.converted[0].convertedValueMinor);
  });

  it("falls back to excluded if no FX rate is available for foreign holding", () => {
    const fxRates = [
      { base: "CAD" as const, quote: "USD" as const, rate: 0.7331, asOf: "2026-08-18T00:00:00Z" },
    ];

    // GBP rate is missing, so GBP holding is excluded while USD holding is converted
    const result = holdingsValuation(
      [h("TSLA", 10, 33687, "USD"), h("ULVR.L", 5, 4500, "GBP")],
      "CAD",
      fxRates,
    );

    expect(result.complete).toBe(false);
    expect(result.converted).toHaveLength(1);
    expect(result.converted[0].symbol).toBe("TSLA");
    expect(result.excluded).toEqual([{ symbol: "ULVR.L", priceCurrency: "GBP", reason: "currency-mismatch" }]);
  });
});
