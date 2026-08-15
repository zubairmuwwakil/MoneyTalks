import { describe, expect, it } from "vitest";
import { convertMinor, MissingFxRateError, type FxRateInput } from "./fx";

const rates: FxRateInput[] = [
  { base: "USD", quote: "CAD", rate: 1.35, asOf: "2026-01-01" },
  { base: "USD", quote: "CAD", rate: 1.4, asOf: "2026-08-01" }, // latest wins
  { base: "JMD", quote: "CAD", rate: 0.009, asOf: "2026-08-01" },
];

describe("convertMinor", () => {
  it("returns the amount unchanged for same-currency", () => {
    expect(convertMinor(1000, "CAD", "CAD", [])).toBe(1000);
  });

  it("uses the latest direct rate", () => {
    expect(convertMinor(10000, "USD", "CAD", rates)).toBe(14000); // 1.40, not 1.35
  });

  it("falls back to the inverse rate", () => {
    expect(convertMinor(14000, "CAD", "USD", rates)).toBe(10000); // 14000 / 1.40
  });

  it("rounds to integer minor units", () => {
    expect(convertMinor(999, "USD", "CAD", rates)).toBe(1399); // 999 * 1.4 = 1398.6
  });

  it("throws MissingFxRateError when no path exists", () => {
    expect(() => convertMinor(1000, "USD", "JMD", rates)).toThrow(MissingFxRateError);
  });

  it("rejects non-integer amounts", () => {
    expect(() => convertMinor(10.5, "USD", "CAD", rates)).toThrow(RangeError);
  });
});
