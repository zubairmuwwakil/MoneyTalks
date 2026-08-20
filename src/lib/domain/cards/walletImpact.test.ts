import { describe, expect, it } from "vitest";
import { buildWalletImpact } from "./walletImpact";

describe("buildWalletImpact", () => {
  it("compares recorded rewards and redeemed credits with the effective annual fee", () => {
    const view = buildWalletImpact(
      [
        {
          id: "c1",
          nickname: "Daily Card",
          issuer: "Fixture Bank",
          annualFeeMinor: 20_000,
          feeRebateMinor: 4_500,
          rewardsEstimateMinor: 10_000,
          credits: [
            { creditId: "dining", valueCad: 70, period: "calendarYear" },
            { creditId: "mobile", valueCad: 20, period: "calendarMonth" },
          ],
          redeemed: [
            { creditId: "dining", periodKey: "2026" },
            { creditId: "mobile", periodKey: "2026-07" },
            { creditId: "mobile", periodKey: "2026-08" },
          ],
        },
      ],
      2026,
    );

    expect(view.rows[0]).toMatchObject({
      realizedMinor: 21_000,
      feeMinor: 15_500,
      netMinor: 5_500,
      status: "ahead",
    });
    expect(view).toMatchObject({
      totalRealizedMinor: 21_000,
      totalFeeMinor: 15_500,
      totalNetMinor: 5_500,
      breakEvenCount: 1,
      feeCardCount: 1,
    });
  });

  it("ignores unredeemed, duplicate, and prior-year credit periods", () => {
    const view = buildWalletImpact(
      [
        {
          id: "c1",
          nickname: "Travel Card",
          issuer: "Fixture Bank",
          annualFeeMinor: 12_000,
          feeRebateMinor: 0,
          rewardsEstimateMinor: 0,
          credits: [
            { creditId: "travel", valueCad: 100, period: "calendarYear" },
            { creditId: "monthly", valueCad: 10, period: "calendarMonth" },
          ],
          redeemed: [
            { creditId: "monthly", periodKey: "2025-12" },
            { creditId: "monthly", periodKey: "2026-08" },
            { creditId: "monthly", periodKey: "2026-08" },
          ],
        },
      ],
      2026,
    );

    expect(view.rows[0]).toMatchObject({ realizedMinor: 1_000, netMinor: -11_000, status: "short" });
  });

  it("handles no-fee cards without dividing by zero", () => {
    const view = buildWalletImpact(
      [
        {
          id: "c1",
          nickname: "No Fee",
          issuer: "Fixture Bank",
          annualFeeMinor: 0,
          feeRebateMinor: 0,
          rewardsEstimateMinor: 2_500,
          credits: [],
          redeemed: [],
        },
      ],
      2026,
    );

    expect(view.rows[0]).toMatchObject({
      status: "no-fee",
      valuePct: 100,
      feePct: 0,
      netMinor: 2_500,
    });
    expect(view.feeCardCount).toBe(0);
    expect(view.breakEvenCount).toBe(0);
  });

  it("sorts fee cards by the largest shortfall before cards already ahead", () => {
    const view = buildWalletImpact(
      [
        {
          id: "ahead",
          nickname: "Ahead",
          issuer: "Fixture Bank",
          annualFeeMinor: 10_000,
          feeRebateMinor: 0,
          rewardsEstimateMinor: 12_000,
          credits: [],
          redeemed: [],
        },
        {
          id: "short",
          nickname: "Short",
          issuer: "Fixture Bank",
          annualFeeMinor: 20_000,
          feeRebateMinor: 0,
          rewardsEstimateMinor: 5_000,
          credits: [],
          redeemed: [],
        },
      ],
      2026,
    );

    expect(view.rows.map((row) => row.id)).toEqual(["short", "ahead"]);
  });
});
