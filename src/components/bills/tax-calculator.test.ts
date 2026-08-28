import { describe, expect, it } from "vitest";
import { calculateTax, CANADIAN_TAX_PRESETS } from "./tax-calculator";

describe("calculateTax", () => {
  it("calculates 13% Ontario HST on a pre-tax amount (add_tax mode)", () => {
    // e.g. Base $87.57 * 1.13 = $98.9541 -> $98.95
    const result = calculateTax({
      amount: 87.57,
      ratePct: 13,
      mode: "add_tax",
    });

    expect(result.baseAmount).toBe(87.57);
    expect(result.taxRatePct).toBe(13);
    expect(result.taxAmount).toBe(11.38);
    expect(result.totalAmount).toBe(98.95);
  });

  it("calculates 5% Alberta GST on a pre-tax amount", () => {
    const result = calculateTax({
      amount: 100,
      ratePct: 5,
      mode: "add_tax",
    });

    expect(result.baseAmount).toBe(100);
    expect(result.taxAmount).toBe(5);
    expect(result.totalAmount).toBe(105);
  });

  it("extracts base and tax from a total amount (extract_tax mode)", () => {
    // e.g. Total $98.95 at 13% HST -> Base $87.57, Tax $11.38
    const result = calculateTax({
      amount: 98.95,
      ratePct: 13,
      mode: "extract_tax",
    });

    expect(result.totalAmount).toBe(98.95);
    expect(result.baseAmount).toBe(87.57);
    expect(result.taxAmount).toBe(11.38);
  });

  it("handles Quebec 14.975% GST+QST", () => {
    const result = calculateTax({
      amount: 100,
      ratePct: 14.975,
      mode: "add_tax",
    });

    expect(result.baseAmount).toBe(100);
    expect(result.taxAmount).toBe(14.98);
    expect(result.totalAmount).toBe(114.98);
  });

  it("handles custom rates and zero/invalid inputs safely", () => {
    expect(
      calculateTax({
        amount: 0,
        ratePct: 13,
        mode: "add_tax",
      }),
    ).toEqual({
      baseAmount: 0,
      taxRatePct: 13,
      taxAmount: 0,
      totalAmount: 0,
      mode: "add_tax",
    });

    expect(
      calculateTax({
        amount: -50,
        ratePct: 13,
        mode: "add_tax",
      }),
    ).toEqual({
      baseAmount: 0,
      taxRatePct: 13,
      taxAmount: 0,
      totalAmount: 0,
      mode: "add_tax",
    });
  });

  it("includes all major Canadian tax regions in presets", () => {
    const ids = CANADIAN_TAX_PRESETS.map((p) => p.id);
    expect(ids).toContain("on");
    expect(ids).toContain("bc");
    expect(ids).toContain("qc");
    expect(ids).toContain("ab");
    expect(ids).toContain("atl");
  });
});
