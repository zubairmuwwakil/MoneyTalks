import {
  aggregatePortfolioPoints,
  attributePositionChanges,
  calculatePerformance,
  type PerformanceSummary,
  type PositionContribution,
  type PositionPoint,
  type ValuationPoint,
} from "@/engine/investmentPerformance";
import type { Currency } from "@/engine/money";

export type PerformanceRange = "1M" | "3M" | "YTD" | "1Y" | "ALL";

export type PerformancePositionInput = PositionPoint;

export type PerformanceSnapshotInput = {
  asOf: string;
  currency: Currency;
  totalMinor: number;
  netExternalFlowMinor: number;
  displayTotalMinor: number;
  displayExternalFlowMinor: number;
  status: "COMPLETE" | "PARTIAL";
  positions: PerformancePositionInput[];
};

export type PerformanceAccountInput = {
  id: string;
  name: string;
  currency: Currency;
  hasSetupData: boolean;
  snapshots: PerformanceSnapshotInput[];
};

export type PerformanceAccountView = {
  id: string;
  name: string;
  currency: Currency;
  status: "tracking" | "needs-setup" | "incomplete";
  currentValueMinor: number | null;
  summary: PerformanceSummary;
  movers: PositionContribution[];
};

export type PerformanceWorkspaceView = {
  state: "pending" | "tracking" | "incomplete";
  trackingSince: string | null;
  latestCompleteAsOf: string | null;
  portfolio: PerformanceSummary;
  accounts: PerformanceAccountView[];
  movers: PositionContribution[];
  dataHealth: { needsAttention: boolean; partialAccounts: string[] };
};

function dateKey(value: string): string {
  return value.slice(0, 10);
}

function sortedSnapshots(snapshots: PerformanceSnapshotInput[]): PerformanceSnapshotInput[] {
  return [...snapshots].sort((left, right) => dateKey(left.asOf).localeCompare(dateKey(right.asOf)));
}

function rangeStart(range: PerformanceRange, today: Date): string | null {
  if (range === "ALL") return null;
  const result = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (range === "YTD") {
    result.setUTCMonth(0, 1);
  } else if (range === "1M") {
    setClampedUtcMonth(result, result.getUTCMonth() - 1);
  } else if (range === "3M") {
    setClampedUtcMonth(result, result.getUTCMonth() - 3);
  } else {
    setClampedUtcMonth(result, result.getUTCMonth() - 12);
  }
  return result.toISOString().slice(0, 10);
}

function setClampedUtcMonth(value: Date, targetMonth: number): void {
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(targetMonth);
  const lastDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
}

/**
 * Includes the last observation before the boundary as the opening baseline.
 * With daily data this is normally the prior close; it prevents a period's
 * first cash flow from becoming the baseline and disappearing from its math.
 */
function pointsForRange(points: ValuationPoint[], range: PerformanceRange, today: Date): ValuationPoint[] {
  const start = rangeStart(range, today);
  if (start === null) return points;

  const inRange = points.filter((point) => point.date >= start);
  const baseline = [...points].reverse().find((point) => point.date < start);
  return baseline ? [baseline, ...inRange] : inRange;
}

function completeSnapshots(account: PerformanceAccountInput): PerformanceSnapshotInput[] {
  return sortedSnapshots(account.snapshots).filter((snapshot) => snapshot.status === "COMPLETE");
}

function nativePoints(account: PerformanceAccountInput): ValuationPoint[] {
  return completeSnapshots(account).map((snapshot) => ({
    date: dateKey(snapshot.asOf),
    valueMinor: snapshot.totalMinor,
    externalFlowMinor: snapshot.netExternalFlowMinor,
  }));
}

function displayPoints(account: PerformanceAccountInput): ValuationPoint[] {
  return completeSnapshots(account).map((snapshot) => ({
    date: dateKey(snapshot.asOf),
    valueMinor: snapshot.displayTotalMinor,
    externalFlowMinor: snapshot.displayExternalFlowMinor,
  }));
}

function positionsOnDate(accounts: PerformanceAccountInput[], date: string): PositionPoint[] {
  const bySymbol = new Map<string, PositionPoint>();
  for (const account of accounts) {
    const snapshot = account.snapshots.find(
      (candidate) => candidate.status === "COMPLETE" && dateKey(candidate.asOf) === date,
    );
    if (!snapshot) continue;

    for (const position of snapshot.positions) {
      const current = bySymbol.get(position.symbol);
      bySymbol.set(position.symbol, {
        symbol: position.symbol,
        quantity: (current?.quantity ?? 0) + position.quantity,
        displayValueMinor: (current?.displayValueMinor ?? 0) + position.displayValueMinor,
      });
    }
  }
  return [...bySymbol.values()];
}

function moversForSeries(
  accounts: PerformanceAccountInput[],
  series: PerformanceSummary["series"],
): PositionContribution[] {
  const attribution = new Map<string, { contributionMinor: number; changed: boolean }>();
  for (let index = 1; index < series.length; index += 1) {
    const interval = attributePositionChanges(
      positionsOnDate(accounts, series[index - 1].date),
      positionsOnDate(accounts, series[index].date),
    );
    for (const contribution of interval) {
      const accumulated = attribution.get(contribution.symbol) ?? {
        contributionMinor: 0,
        changed: false,
      };
      if (contribution.eligible) {
        accumulated.contributionMinor += contribution.contributionMinor ?? 0;
      } else {
        accumulated.changed = true;
      }
      attribution.set(contribution.symbol, accumulated);
    }
  }

  return [...attribution.entries()]
    .map(([symbol, value]): PositionContribution =>
      value.changed
        ? { symbol, contributionMinor: null, eligible: false, reason: "position-changed" }
        : { symbol, contributionMinor: value.contributionMinor, eligible: true, reason: null },
    )
    .sort((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      if (left.eligible && right.eligible) {
        return Math.abs(right.contributionMinor ?? 0) - Math.abs(left.contributionMinor ?? 0);
      }
      return left.symbol.localeCompare(right.symbol);
    });
}

export function buildPerformanceWorkspace(
  accounts: PerformanceAccountInput[],
  range: PerformanceRange,
  today: Date,
): PerformanceWorkspaceView {
  const accountSeries = accounts.map((account) => ({
    accountId: account.id,
    points: displayPoints(account),
  }));
  const portfolioPoints = pointsForRange(aggregatePortfolioPoints(accountSeries), range, today);
  const portfolio = calculatePerformance(portfolioPoints);
  const partialAccounts: string[] = [];

  const accountViews = accounts.map((account): PerformanceAccountView => {
    const allSnapshots = sortedSnapshots(account.snapshots);
    const complete = allSnapshots.filter((snapshot) => snapshot.status === "COMPLETE");
    const latest = allSnapshots.at(-1);
    const latestComplete = complete.at(-1);
    let status: PerformanceAccountView["status"];
    if (!account.hasSetupData && allSnapshots.length === 0) {
      status = "needs-setup";
    } else if (!latestComplete || latest?.status === "PARTIAL") {
      status = "incomplete";
      partialAccounts.push(account.name);
    } else {
      status = "tracking";
    }

    const summary = calculatePerformance(pointsForRange(nativePoints(account), range, today));
    return {
      id: account.id,
      name: account.name,
      currency: account.currency,
      status,
      currentValueMinor: latestComplete?.totalMinor ?? null,
      summary,
      movers: moversForSeries([account], summary.series),
    };
  });

  const needsAttention = partialAccounts.length > 0;
  return {
    state:
      portfolio.series.length === 0 ? "pending" : needsAttention ? "incomplete" : "tracking",
    trackingSince: portfolio.startDate,
    latestCompleteAsOf: portfolio.endDate,
    portfolio,
    accounts: accountViews,
    movers: moversForSeries(accounts, portfolio.series),
    dataHealth: { needsAttention, partialAccounts },
  };
}
