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
});
