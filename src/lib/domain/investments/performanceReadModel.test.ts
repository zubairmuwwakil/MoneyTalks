import { describe, expect, it } from "vitest";
import {
  buildPerformanceWorkspace,
  type PerformanceAccountInput,
  type PerformanceSnapshotInput,
} from "./performanceReadModel";

const TODAY = new Date("2026-08-20T12:00:00.000Z");

function snapshot(
  asOf: string,
  totalMinor: number,
  options: Partial<PerformanceSnapshotInput> = {},
): PerformanceSnapshotInput {
  return {
    asOf,
    currency: "CAD",
    cashMinor: 0,
    holdingsMinor: totalMinor,
    totalMinor,
    netExternalFlowMinor: 0,
    displayTotalMinor: totalMinor,
    displayExternalFlowMinor: 0,
    status: "COMPLETE",
    positions: [],
    ...options,
  };
}

function account(overrides: Partial<PerformanceAccountInput> = {}): PerformanceAccountInput {
  return {
    id: "account-1",
    name: "Main RRSP",
    currency: "CAD",
    hasSetupData: true,
    snapshots: [],
    ...overrides,
  };
}

describe("buildPerformanceWorkspace", () => {
  it("returns pending when no complete snapshot exists", () => {
    const view = buildPerformanceWorkspace(
      [
        account({
          snapshots: [snapshot("2026-08-20", 10_000, { status: "PARTIAL" })],
        }),
      ],
      "ALL",
      TODAY,
    );

    expect(view.state).toBe("pending");
    expect(view.trackingSince).toBeNull();
    expect(view.portfolio.endValueMinor).toBeNull();
    expect(view.dataHealth).toEqual({ needsAttention: true, partialAccounts: ["Main RRSP"] });
  });

  it("tracks a real zero after one complete snapshot without inventing a return", () => {
    const view = buildPerformanceWorkspace(
      [account({ snapshots: [snapshot("2026-08-20", 0)] })],
      "ALL",
      TODAY,
    );

    expect(view.state).toBe("tracking");
    expect(view.trackingSince).toBe("2026-08-20");
    expect(view.portfolio).toMatchObject({ endValueMinor: 0, gainMinor: null, twr: null });
    expect(view.accounts[0]).toMatchObject({ status: "tracking", currentValueMinor: 0 });
  });

  it("keeps the last complete headline when the latest snapshot is partial", () => {
    const view = buildPerformanceWorkspace(
      [
        account({
          snapshots: [
            snapshot("2026-08-19", 10_000, { cashMinor: 2_000, holdingsMinor: 8_000 }),
            snapshot("2026-08-20", 10_500, { status: "PARTIAL" }),
          ],
        }),
      ],
      "ALL",
      TODAY,
    );

    expect(view.state).toBe("incomplete");
    expect(view.latestCompleteAsOf).toBe("2026-08-19");
    expect(view.portfolio.endValueMinor).toBe(10_000);
    expect(view.accounts[0]).toMatchObject({
      status: "incomplete",
      currentValueMinor: 10_000,
      currentCashMinor: 2_000,
      currentHoldingsMinor: 8_000,
    });
    expect(view.dataHealth.needsAttention).toBe(true);
  });

  it("distinguishes an account with no evidence from a measured zero", () => {
    const view = buildPerformanceWorkspace(
      [
        account({ id: "empty", name: "Empty TFSA", hasSetupData: false }),
        account({ id: "zero", name: "Cash", snapshots: [snapshot("2026-08-20", 0)] }),
      ],
      "ALL",
      TODAY,
    );

    expect(view.accounts).toEqual([
      expect.objectContaining({ id: "empty", status: "needs-setup", currentValueMinor: null }),
      expect.objectContaining({ id: "zero", status: "tracking", currentValueMinor: 0 }),
    ]);
  });

  it("keeps needs-setup authoritative after a diagnostic partial capture", () => {
    const view = buildPerformanceWorkspace(
      [
        account({
          id: "empty",
          name: "Empty TFSA",
          hasSetupData: false,
          snapshots: [snapshot("2026-08-20", 0, { status: "PARTIAL" })],
        }),
      ],
      "ALL",
      TODAY,
    );

    expect(view.accounts[0]).toMatchObject({ status: "needs-setup", currentValueMinor: null });
    expect(view.dataHealth).toEqual({ needsAttention: false, partialAccounts: [] });
  });

  it("marks an account incomplete when the expected nightly capture is missing", () => {
    const view = buildPerformanceWorkspace(
      [account({ snapshots: [snapshot("2026-08-19", 10_000)] })],
      "ALL",
      TODAY,
    );

    expect(view.accounts[0]).toMatchObject({ status: "incomplete", currentValueMinor: 10_000 });
    expect(view.dataHealth.partialAccounts).toEqual(["Main RRSP"]);
  });

  it("uses the same selected range for metrics and chart series", () => {
    const snapshots = [
      snapshot("2026-01-01", 10_000),
      snapshot("2026-07-19", 12_000),
      snapshot("2026-08-01", 12_600, { netExternalFlowMinor: 500, displayExternalFlowMinor: 500 }),
      snapshot("2026-08-20", 13_000),
    ];
    const all = buildPerformanceWorkspace([account({ snapshots })], "ALL", TODAY);
    const month = buildPerformanceWorkspace([account({ snapshots })], "1M", TODAY);

    expect(all.portfolio.series.map((point) => point.date)).toEqual([
      "2026-01-01",
      "2026-07-19",
      "2026-08-01",
      "2026-08-20",
    ]);
    expect(all.portfolio.gainMinor).toBe(2_500);
    expect(month.portfolio.series.map((point) => point.date)).toEqual([
      "2026-07-19",
      "2026-08-01",
      "2026-08-20",
    ]);
    expect(month.portfolio.gainMinor).toBe(500);
  });

  it("excludes quantity-change intervals from mover attribution", () => {
    const view = buildPerformanceWorkspace(
      [
        account({
          snapshots: [
            snapshot("2026-08-18", 20_000, {
              positions: [
                { symbol: "AAPL", quantity: 2, displayValueMinor: 10_000 },
                { symbol: "SHOP", quantity: 3, displayValueMinor: 10_000 },
              ],
            }),
            snapshot("2026-08-19", 22_000, {
              positions: [
                { symbol: "AAPL", quantity: 2, displayValueMinor: 11_500 },
                { symbol: "SHOP", quantity: 4, displayValueMinor: 10_500 },
              ],
            }),
            snapshot("2026-08-20", 23_000, {
              positions: [
                { symbol: "AAPL", quantity: 2, displayValueMinor: 12_500 },
                { symbol: "SHOP", quantity: 4, displayValueMinor: 10_500 },
              ],
            }),
          ],
        }),
      ],
      "ALL",
      TODAY,
    );

    expect(view.movers).toEqual([
      { symbol: "AAPL", contributionMinor: 2_500, eligible: true, reason: null, excludedIntervals: 0 },
      { symbol: "SHOP", contributionMinor: 0, eligible: true, reason: null, excludedIntervals: 1 },
    ]);
  });

  it("keeps eligible mover attribution while disclosing excluded quantity-change intervals", () => {
    const view = buildPerformanceWorkspace(
      [
        account({
          snapshots: [
            snapshot("2026-08-18", 10_000, {
              positions: [{ symbol: "SHOP", quantity: 1, displayValueMinor: 10_000 }],
            }),
            snapshot("2026-08-19", 10_500, {
              positions: [{ symbol: "SHOP", quantity: 2, displayValueMinor: 10_500 }],
            }),
            snapshot("2026-08-20", 11_000, {
              positions: [{ symbol: "SHOP", quantity: 2, displayValueMinor: 11_000 }],
            }),
          ],
        }),
      ],
      "ALL",
      TODAY,
    );

    expect(view.movers).toEqual([
      {
        symbol: "SHOP",
        contributionMinor: 500,
        eligible: true,
        reason: null,
        excludedIntervals: 1,
      },
    ]);
  });
});
