import { describe, expect, it } from "vitest";
import {
  diagnoseAccountDataHealth,
  expectedCaptureDate,
  type AccountDataHealthInput,
} from "./accountDataHealth";

describe("accountDataHealth", () => {
  const today = new Date("2026-08-22T14:00:00.000Z");
  const fxRates = [
    {
      base: "USD" as const,
      quote: "CAD" as const,
      rate: 1.35,
      asOf: "2026-08-22T00:00:00.000Z",
    },
  ];

  it("identifies accounts needing setup when no holdings, snapshots, or transactions exist", () => {
    const input: AccountDataHealthInput = {
      id: "acc-1",
      name: "Empty TFSA",
      currency: "CAD",
      type: "TFSA",
      holdings: [],
      transactions: [],
      snapshots: [],
      investmentSnapshots: [],
      fxRates,
      today,
    };

    const report = diagnoseAccountDataHealth(input);
    expect(report.status).toBe("needs-setup");
    expect(report.hasSetupData).toBe(false);
    expect(report.isComplete).toBe(false);
    expect(report.issues.some((i) => i.id === "needs-setup")).toBe(true);
  });

  it("identifies data incomplete when account has holdings but no investment snapshot has been captured yet", () => {
    const input: AccountDataHealthInput = {
      id: "acc-1",
      name: "agression",
      currency: "CAD",
      type: "TFSA",
      holdings: [
        {
          id: "h-1",
          symbol: "TSLA",
          name: "Tesla",
          quantity: 10,
          lastPriceMinor: 20000,
          priceCurrency: "USD",
          priceAsOf: "2026-08-22T00:00:00.000Z",
          priceStatus: "FRESH",
        },
      ],
      transactions: [
        {
          id: "tx-1",
          type: "CONTRIBUTION",
          amountMinor: 100,
          currency: "CAD",
          date: "2026-08-05T00:00:00.000Z",
        },
      ],
      snapshots: [],
      investmentSnapshots: [],
      fxRates,
      today,
    };

    const report = diagnoseAccountDataHealth(input);
    expect(report.status).toBe("incomplete");
    expect(report.hasSetupData).toBe(true);
    expect(report.isComplete).toBe(false);
    expect(report.issues.some((i) => i.id === "snapshot-none")).toBe(true);
    expect(report.latestSnapshot).toBeNull();
  });

  it("identifies out-of-date valuation and stale market quotes when snapshot is from a prior date", () => {
    const input: AccountDataHealthInput = {
      id: "acc-1",
      name: "agression",
      currency: "CAD",
      type: "TFSA",
      holdings: [
        {
          id: "h-1",
          symbol: "TSLA",
          name: "Tesla",
          quantity: 17.6513,
          lastPriceMinor: 20000,
          priceCurrency: "USD",
          priceAsOf: "2026-08-15T00:00:00.000Z",
          priceStatus: "FRESH",
        },
        {
          id: "h-2",
          symbol: "ENPB.TO",
          name: "Enbridge",
          quantity: 10.4,
          lastPriceMinor: 4385,
          priceCurrency: "CAD",
          priceAsOf: "2026-08-15T00:00:00.000Z",
          priceStatus: "FRESH",
        },
      ],
      transactions: [
        {
          id: "tx-1",
          type: "CONTRIBUTION",
          amountMinor: 100,
          currency: "CAD",
          date: "2026-08-05T00:00:00.000Z",
        },
      ],
      snapshots: [],
      investmentSnapshots: [
        {
          id: "snap-1",
          asOf: "2026-08-15T00:00:00.000Z",
          currency: "CAD",
          status: "COMPLETE",
          cashMinor: 100,
          holdingsMinor: 529629,
          totalMinor: 529729,
          holdingCount: 2,
          pricedHoldingCount: 2,
        },
      ],
      fxRates,
      today,
    };

    const report = diagnoseAccountDataHealth(input);
    expect(report.status).toBe("incomplete");
    expect(report.latestCompleteAsOf).toBe("2026-08-15");
    expect(report.latestSnapshot?.isUpToDate).toBe(false);

    // Should flag snapshot out-of-date and stale prices
    const snapshotIssue = report.issues.find((i) => i.id === "snapshot-outdated");
    expect(snapshotIssue).toBeDefined();
    expect(snapshotIssue?.description).toContain("2026-08-15");

    const staleIssue = report.issues.find((i) => i.id === "stale-market-quotes");
    expect(staleIssue).toBeDefined();
    expect(staleIssue?.affectedSymbols).toEqual(["TSLA", "ENPB.TO"]);
  });

  it("identifies missing FX rates for foreign currency holdings", () => {
    const input: AccountDataHealthInput = {
      id: "acc-1",
      name: "CAD Account with USD Stock",
      currency: "CAD",
      type: "TFSA",
      holdings: [
        {
          id: "h-1",
          symbol: "AAPL",
          name: "Apple",
          quantity: 5,
          lastPriceMinor: 18000,
          priceCurrency: "USD",
          priceAsOf: "2026-08-22T00:00:00.000Z",
          priceStatus: "FRESH",
        },
      ],
      transactions: [],
      snapshots: [],
      investmentSnapshots: [],
      fxRates: [], // No FX rates provided!
      today,
    };

    const report = diagnoseAccountDataHealth(input);
    expect(report.status).toBe("incomplete");
    const fxIssue = report.issues.find((i) => i.id === "missing-fx-rates");
    expect(fxIssue).toBeDefined();
    expect(fxIssue?.affectedSymbols).toContain("AAPL");
    expect(report.fxHealth.missingPairs).toEqual([{ from: "USD", to: "CAD" }]);
  });

  it("identifies unpriced holdings ($0.00)", () => {
    const input: AccountDataHealthInput = {
      id: "acc-1",
      name: "Unpriced Holding Account",
      currency: "CAD",
      type: "TFSA",
      holdings: [
        {
          id: "h-1",
          symbol: "NEWSTOCK",
          name: "New Stock",
          quantity: 50,
          lastPriceMinor: 0,
          priceCurrency: "CAD",
          priceAsOf: "2026-08-22T00:00:00.000Z",
          priceStatus: "FRESH",
        },
      ],
      transactions: [],
      snapshots: [],
      investmentSnapshots: [],
      fxRates,
      today,
    };

    const report = diagnoseAccountDataHealth(input);
    expect(report.status).toBe("incomplete");
    const unpricedIssue = report.issues.find((i) => i.id === "unpriced-holdings");
    expect(unpricedIssue).toBeDefined();
    expect(unpricedIssue?.affectedSymbols).toContain("NEWSTOCK");
  });

  it("identifies partial snapshot recording", () => {
    const input: AccountDataHealthInput = {
      id: "acc-1",
      name: "Partial Snapshot Account",
      currency: "CAD",
      type: "TFSA",
      holdings: [
        {
          id: "h-1",
          symbol: "TSLA",
          name: "Tesla",
          quantity: 10,
          lastPriceMinor: 20000,
          priceCurrency: "USD",
          priceAsOf: "2026-08-22T00:00:00.000Z",
          priceStatus: "FRESH",
        },
      ],
      transactions: [],
      snapshots: [],
      investmentSnapshots: [
        {
          id: "snap-1",
          asOf: "2026-08-22T00:00:00.000Z",
          currency: "CAD",
          status: "PARTIAL",
          cashMinor: 0,
          holdingsMinor: 0,
          totalMinor: 0,
          holdingCount: 1,
          pricedHoldingCount: 0,
        },
      ],
      fxRates,
      today,
    };

    const report = diagnoseAccountDataHealth(input);
    expect(report.status).toBe("incomplete");
    const partialIssue = report.issues.find((i) => i.id === "snapshot-partial");
    expect(partialIssue).toBeDefined();
  });

  it("reports tracking and complete status when all holdings are priced fresh with matching FX and up-to-date snapshot", () => {
    const input: AccountDataHealthInput = {
      id: "acc-1",
      name: "Healthy Account",
      currency: "CAD",
      type: "TFSA",
      holdings: [
        {
          id: "h-1",
          symbol: "TSLA",
          name: "Tesla",
          quantity: 10,
          lastPriceMinor: 20000,
          priceCurrency: "USD",
          priceAsOf: "2026-08-22T00:00:00.000Z",
          priceStatus: "FRESH",
        },
      ],
      transactions: [
        {
          id: "tx-1",
          type: "CONTRIBUTION",
          amountMinor: 50000,
          currency: "CAD",
          date: "2026-08-01T00:00:00.000Z",
        },
      ],
      snapshots: [],
      investmentSnapshots: [
        {
          id: "snap-1",
          asOf: "2026-08-22T00:00:00.000Z",
          currency: "CAD",
          status: "COMPLETE",
          cashMinor: 50000,
          holdingsMinor: 270000,
          totalMinor: 320000,
          holdingCount: 1,
          pricedHoldingCount: 1,
        },
      ],
      fxRates,
      today,
    };

    const report = diagnoseAccountDataHealth(input);
    expect(report.status).toBe("tracking");
    expect(report.isComplete).toBe(true);
    expect(report.latestSnapshot?.isUpToDate).toBe(true);
    expect(report.issues.length).toBe(0);
  });
});
