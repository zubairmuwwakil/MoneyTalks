import { describe, expect, it } from "vitest";
import { assertCurrencyCode, minorUnit, minorUnitFromBigInt, minorUnitToBigInt } from "./money";

describe("money boundary primitives", () => {
  it("accepts safe integer minor units and round-trips bigint values", () => {
    const value = minorUnit(12_345);
    expect(minorUnitToBigInt(value)).toBe(BigInt(12_345));
    expect(minorUnitFromBigInt(BigInt(12_345))).toBe(12_345);
  });

  it("rejects fractions and values outside the safe integer range", () => {
    expect(() => minorUnit(1.5)).toThrow(RangeError);
    expect(() => minorUnitFromBigInt(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1))).toThrow(RangeError);
  });

  it("normalizes and validates currency codes at boundaries", () => {
    expect(assertCurrencyCode(" cad ")).toBe("CAD");
    expect(() => assertCurrencyCode("CAD$" as string)).toThrow(RangeError);
  });
});
