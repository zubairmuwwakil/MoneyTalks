import { describe, expect, it } from "vitest";
import {
  aggregatePortfolioPoints,
  attributePositionChanges,
  calculatePerformance,
} from "./investmentPerformance";

describe("calculatePerformance", () => {
  it("calculates gain and return with no external flow", () => {
    const result = calculatePerformance([
      { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 10_500, externalFlowMinor: 0 },
    ]);
    expect(result).toMatchObject({ gainMinor: 500, netFlowMinor: 0 });
    expect(result.twr).toBeCloseTo(0.05);
  });

  it("removes a contribution from investment gain", () => {
    const result = calculatePerformance([
      { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 11_500, externalFlowMinor: 1_000 },
    ]);
    expect(result).toMatchObject({ gainMinor: 500, netFlowMinor: 1_000 });
    expect(result.twr).toBeCloseTo(0.05);
  });

  it("does not report a withdrawal as a loss", () => {
    const result = calculatePerformance([
      { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 8_500, externalFlowMinor: -2_000 },
    ]);
    expect(result).toMatchObject({ gainMinor: 500, netFlowMinor: -2_000 });
    expect(result.twr).toBeCloseTo(0.05);
  });

  it("chains daily return factors multiplicatively", () => {
    const result = calculatePerformance([
      { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 11_000, externalFlowMinor: 0 },
      { date: "2026-08-22", valueMinor: 12_100, externalFlowMinor: 0 },
    ]);

    expect(result.twr).toBeCloseTo(0.21);
    expect(result.series.at(-1)).toMatchObject({ gainMinor: 2_100 });
    expect(result.series.at(-1)?.dailyReturn).toBeCloseTo(0.1);
    expect(result.series.at(-1)?.cumulativeReturn).toBeCloseTo(0.21);
  });

  it("calculates across a missing calendar day without inventing a point", () => {
    const result = calculatePerformance([
      { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
      { date: "2026-08-23", valueMinor: 10_250, externalFlowMinor: 0 },
    ]);

    expect(result.series).toHaveLength(2);
    expect(result).toMatchObject({ gainMinor: 250 });
    expect(result.twr).toBeCloseTo(0.025);
  });

  it("starts a new return segment after a zero baseline", () => {
    const result = calculatePerformance([
      { date: "2026-08-20", valueMinor: 0, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 1_000, externalFlowMinor: 1_000 },
      { date: "2026-08-22", valueMinor: 1_100, externalFlowMinor: 0 },
    ]);

    expect(result).toMatchObject({ gainMinor: 100, netFlowMinor: 1_000 });
    expect(result.twr).toBeCloseTo(0.1);
    expect(result.series[1]).toMatchObject({ dailyReturn: null, cumulativeReturn: null });
    expect(result.series[2].dailyReturn).toBeCloseTo(0.1);
    expect(result.series[2].cumulativeReturn).toBeCloseTo(0.1);
    expect(Number.isFinite(result.twr)).toBe(true);
  });

  it("reports last-close performance after removing the latest flow", () => {
    const result = calculatePerformance([
      { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 11_000, externalFlowMinor: 0 },
      { date: "2026-08-22", valueMinor: 12_600, externalFlowMinor: 1_500 },
    ]);

    expect(result.lastCloseGainMinor).toBe(100);
    expect(result.lastCloseReturn).toBeCloseTo(100 / 11_000);
  });

  it("requires two observations and rejects unsafe minor-unit inputs", () => {
    expect(calculatePerformance([])).toMatchObject({ gainMinor: null, twr: null, netFlowMinor: 0 });
    expect(
      calculatePerformance([{ date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 }]),
    ).toMatchObject({ gainMinor: null, twr: null, netFlowMinor: 0 });
    expect(() =>
      calculatePerformance([
        { date: "2026-08-20", valueMinor: 0, externalFlowMinor: 0 },
        { date: "2026-08-21", valueMinor: 0, externalFlowMinor: Number.MAX_SAFE_INTEGER },
        { date: "2026-08-22", valueMinor: 0, externalFlowMinor: 1 },
      ]),
    ).toThrow(RangeError);
  });
});

describe("aggregatePortfolioPoints", () => {
  it("sums recorded display values and flows by date", () => {
    expect(
      aggregatePortfolioPoints([
        {
          accountId: "rrsp",
          points: [
            { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
            { date: "2026-08-21", valueMinor: 10_500, externalFlowMinor: 500 },
          ],
        },
        {
          accountId: "tfsa",
          points: [
            { date: "2026-08-20", valueMinor: 5_000, externalFlowMinor: 0 },
            { date: "2026-08-21", valueMinor: 5_250, externalFlowMinor: -250 },
          ],
        },
      ]),
    ).toEqual([
      { date: "2026-08-20", valueMinor: 15_000, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 15_750, externalFlowMinor: 250 },
    ]);
  });

  it("treats a later account opening as a portfolio external flow", () => {
    const points = aggregatePortfolioPoints([
      {
        accountId: "existing",
        points: [
          { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
          { date: "2026-08-21", valueMinor: 10_500, externalFlowMinor: 0 },
        ],
      },
      {
        accountId: "new",
        points: [{ date: "2026-08-21", valueMinor: 5_000, externalFlowMinor: 0 }],
      },
    ]);

    expect(points).toEqual([
      { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
      { date: "2026-08-21", valueMinor: 15_500, externalFlowMinor: 5_000 },
    ]);
    const performance = calculatePerformance(points);
    expect(performance).toMatchObject({ gainMinor: 500 });
    expect(performance.twr).toBeCloseTo(0.05);
  });

  it("does not interpolate an account across a missing complete valuation", () => {
    expect(
      aggregatePortfolioPoints([
        {
          accountId: "one",
          points: [
            { date: "2026-08-20", valueMinor: 10_000, externalFlowMinor: 0 },
            { date: "2026-08-21", valueMinor: 10_100, externalFlowMinor: 0 },
            { date: "2026-08-22", valueMinor: 10_200, externalFlowMinor: 0 },
          ],
        },
        {
          accountId: "two",
          points: [
            { date: "2026-08-20", valueMinor: 5_000, externalFlowMinor: 0 },
            { date: "2026-08-22", valueMinor: 5_100, externalFlowMinor: 0 },
          ],
        },
      ]),
    ).toEqual([
      { date: "2026-08-20", valueMinor: 15_000, externalFlowMinor: 0 },
      { date: "2026-08-22", valueMinor: 15_300, externalFlowMinor: 0 },
    ]);
  });
});

describe("attributePositionChanges", () => {
  it("attributes value changes only when quantity is unchanged", () => {
    expect(
      attributePositionChanges(
        [
          { symbol: "AAPL", quantity: 2, displayValueMinor: 20_000 },
          { symbol: "SHOP", quantity: 3, displayValueMinor: 30_000 },
        ],
        [
          { symbol: "AAPL", quantity: 2, displayValueMinor: 21_500 },
          { symbol: "SHOP", quantity: 4, displayValueMinor: 42_000 },
          { symbol: "NEW", quantity: 1, displayValueMinor: 5_000 },
        ],
      ),
    ).toEqual([
      { symbol: "AAPL", contributionMinor: 1_500, eligible: true, reason: null },
      { symbol: "NEW", contributionMinor: null, eligible: false, reason: "position-changed" },
      { symbol: "SHOP", contributionMinor: null, eligible: false, reason: "position-changed" },
    ]);
  });
});
