import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { walletAmountMinor } from "./amount";

describe("walletAmountMinor", () => {
  it("returns null for null", () => {
    expect(walletAmountMinor(null)).toBeNull();
  });

  it("converts a decimal amount to minor units", () => {
    expect(walletAmountMinor(new Prisma.Decimal("6.42"))).toBe(642);
  });

  it("keeps zero as zero", () => {
    expect(walletAmountMinor(new Prisma.Decimal("0"))).toBe(0);
  });

  it("rounds half-cent amounts up, immune to float artifacts", () => {
    // 4.015 * 100 in float64 is 401.49999..., which Math.round would drop to 401.
    expect(walletAmountMinor(new Prisma.Decimal("4.015"))).toBe(402);
  });
});
