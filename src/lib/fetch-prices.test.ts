import { describe, expect, it } from "vitest";
import { parseCoinGecko } from "./fetch-prices";

describe("parseCoinGecko", () => {
  it("extracts a price in the requested currency as minor units", () => {
    expect(parseCoinGecko({ bitcoin: { usd: 12345.67 } }, "bitcoin", "usd")).toBe(1_234_567);
  });

  it("returns null when missing", () => {
    expect(parseCoinGecko({}, "bitcoin", "usd")).toBeNull();
    expect(parseCoinGecko({ bitcoin: {} }, "bitcoin", "usd")).toBeNull();
  });
});
