import { describe, expect, it } from "vitest";
import { calculateMileageAllowance } from "./mileageTracker";

describe("mileageTracker", () => {
  it("calculates statutory deduction for driving under 5,000 km in provinces", () => {
    // 3,000 km * $0.70/km = $2,100.00 (210000 minor)
    const result = calculateMileageAllowance({
      totalBusinessKm: 3000,
      isTerritory: false,
    });

    expect(result.totalBusinessKm).toBe(3000);
    expect(result.tier1Km).toBe(3000);
    expect(result.tier1Rate).toBe(0.7);
    expect(result.tier1AmountMinor).toBe(210000);
    expect(result.tier2Km).toBe(0);
    expect(result.totalAllowanceMinor).toBe(210000);
  });

  it("calculates tiered deduction crossing the 5,000 km threshold", () => {
    // 6,000 km: (5,000 * 0.70) + (1,000 * 0.64) = $3,500 + $640 = $4,140.00 (414000 minor)
    const result = calculateMileageAllowance({
      totalBusinessKm: 6000,
      isTerritory: false,
    });

    expect(result.tier1Km).toBe(5000);
    expect(result.tier1AmountMinor).toBe(350000);
    expect(result.tier2Km).toBe(1000);
    expect(result.tier2AmountMinor).toBe(64000);
    expect(result.totalAllowanceMinor).toBe(414000);
  });

  it("applies Yukon/NWT territory rates when specified", () => {
    // 2,000 km * $0.74/km = $1,480.00
    const result = calculateMileageAllowance({
      totalBusinessKm: 2000,
      isTerritory: true,
    });

    expect(result.tier1Rate).toBe(0.74);
    expect(result.totalAllowanceMinor).toBe(148000);
  });
});
