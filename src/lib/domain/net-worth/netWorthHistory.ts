import { convertMinor, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";

export type NetWorthRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

export type NetWorthSnapshotInput = {
  asOf: string;
  capturedAt: string;
  currency: Currency;
  totalMinor: number;
  displayCurrency: Currency;
  displayTotalMinor: number;
  status: "COMPLETE" | "PARTIAL";
};

export type NetWorthAccountInput = {
  id: string;
  name: string;
  hasSetupData: boolean;
  trackingFrom?: string;
  snapshots: NetWorthSnapshotInput[];
};

export type NetWorthHistoryPoint = {
  date: string;
  totalMinor: number;
};

export type NetWorthHistoryView = {
  state: "pending" | "tracking" | "incomplete";
  points: NetWorthHistoryPoint[];
  trackingSince: string | null;
  latestCompleteAsOf: string | null;
  incompleteAccounts: string[];
};

export type NetWorthRangeSummary = {
  changeMinor: number | null;
  changePercent: number | null;
};

const MAX_OPENING_BASELINE_AGE_MS = 3 * 86_400_000;

function dateKey(value: string): string {
  return value.slice(0, 10);
}

function expectedCaptureDate(today: Date): string {
  const expected = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (today.getUTCHours() < 4) expected.setUTCDate(expected.getUTCDate() - 1);
  return expected.toISOString().slice(0, 10);
}

type IndexedFxRate = { at: number; rate: FxRateInput };
type FxIndex = Map<string, IndexedFxRate[]>;

function fxPair(base: Currency, quote: Currency): string {
  return `${base}:${quote}`;
}

function buildFxIndex(rates: FxRateInput[]): FxIndex {
  const index: FxIndex = new Map();
  for (const rate of rates) {
    const at = Date.parse(rate.asOf);
    if (!Number.isFinite(at)) continue;
    const key = fxPair(rate.base, rate.quote);
    const entries = index.get(key) ?? [];
    entries.push({ at, rate });
    index.set(key, entries);
  }
  for (const entries of index.values()) {
    entries.sort((left, right) => left.at - right.at);
  }
  return index;
}

function latestRateAt(index: FxIndex, key: string, cutoff: number): FxRateInput | undefined {
  const entries = index.get(key);
  if (!entries || entries.length === 0) return undefined;

  let low = 0;
  let high = entries.length - 1;
  let match: FxRateInput | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = entries[middle];
    if (candidate.at <= cutoff) {
      match = candidate.rate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

function snapshotValue(
  snapshot: NetWorthSnapshotInput,
  displayCurrency: Currency,
  rates: FxIndex,
): number | null {
  if (snapshot.displayCurrency === displayCurrency) return snapshot.displayTotalMinor;
  if (snapshot.currency === displayCurrency) return snapshot.totalMinor;

  const capturedAt = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt)) return null;
  const availableRates = [
    latestRateAt(rates, fxPair(snapshot.currency, displayCurrency), capturedAt),
    latestRateAt(rates, fxPair(displayCurrency, snapshot.currency), capturedAt),
  ].filter((rate): rate is FxRateInput => rate !== undefined);
  try {
    return convertMinor(snapshot.totalMinor, snapshot.currency, displayCurrency, availableRates);
  } catch {
    return null;
  }
}

export function buildNetWorthHistory(
  accounts: NetWorthAccountInput[],
  displayCurrency: Currency,
  rates: FxRateInput[],
  today: Date,
): NetWorthHistoryView {
  const expectedDate = expectedCaptureDate(today);
  const fxIndex = buildFxIndex(rates);
  const trackedAccounts = accounts.filter(
    (account) => account.hasSetupData || account.snapshots.length > 0,
  );
  const incompleteAccounts: string[] = [];

  const accountSeries = trackedAccounts.map((account) => {
    const snapshots = [...account.snapshots].sort((left, right) =>
      dateKey(left.asOf).localeCompare(dateKey(right.asOf)),
    );
    const points = snapshots.flatMap((snapshot) => {
      if (snapshot.status !== "COMPLETE") return [];
      const valueMinor = snapshotValue(snapshot, displayCurrency, fxIndex);
      return valueMinor === null
        ? []
        : [{ date: dateKey(snapshot.asOf), valueMinor, externalFlowMinor: 0 }];
    });
    const latestSnapshot = snapshots.at(-1);
    const latestComplete = points.at(-1);
    if (
      !latestSnapshot ||
      latestSnapshot.status !== "COMPLETE" ||
      !latestComplete ||
      latestComplete.date < expectedDate
    ) {
      incompleteAccounts.push(account.name);
    }

    return {
      accountId: account.id,
      activeFrom: dateKey(account.trackingFrom ?? snapshots[0]?.asOf ?? expectedDate),
      points,
      byDate: new Map(points.map((point) => [point.date, point.valueMinor])),
    };
  });

  const dates = [...new Set(accountSeries.flatMap((account) => account.points.map((point) => point.date)))].sort();
  const points = dates.flatMap((date): NetWorthHistoryPoint[] => {
    const activeAccounts = accountSeries.filter((account) => account.activeFrom <= date);
    if (activeAccounts.length === 0) return [];
    const values = activeAccounts.map((account) => account.byDate.get(date));
    if (values.some((value) => value === undefined)) return [];

    const totalMinor = values.reduce<number>((sum, value) => {
      if (value === undefined) {
        throw new RangeError(`missing active account value for ${date}`);
      }
      const result = sum + value;
      if (!Number.isSafeInteger(result)) {
        throw new RangeError(`net worth total for ${date} must be a safe integer`);
      }
      return result;
    }, 0);
    return [{ date, totalMinor }];
  });

  return {
    state:
      incompleteAccounts.length > 0
        ? "incomplete"
        : points.length < 2
          ? "pending"
          : "tracking",
    points,
    trackingSince: points[0]?.date ?? null,
    latestCompleteAsOf: points.at(-1)?.date ?? null,
    incompleteAccounts: incompleteAccounts.sort((left, right) => left.localeCompare(right)),
  };
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

function rangeStart(range: NetWorthRange, anchor: string): string | null {
  if (range === "ALL") return null;
  const value = new Date(`${anchor}T00:00:00.000Z`);
  if (range === "1W") {
    value.setUTCDate(value.getUTCDate() - 7);
  } else if (range === "1M") {
    setClampedUtcMonth(value, value.getUTCMonth() - 1);
  } else if (range === "3M") {
    setClampedUtcMonth(value, value.getUTCMonth() - 3);
  } else if (range === "YTD") {
    value.setUTCMonth(0, 1);
  } else {
    setClampedUtcMonth(value, value.getUTCMonth() - 12);
  }
  return value.toISOString().slice(0, 10);
}

export function selectNetWorthRange(
  points: NetWorthHistoryPoint[],
  range: NetWorthRange,
): NetWorthHistoryPoint[] {
  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const anchor = sorted.at(-1)?.date;
  if (!anchor || range === "ALL") return sorted;

  const start = rangeStart(range, anchor)!;
  const inRange = sorted.filter((point) => point.date >= start);
  if (inRange[0]?.date === start) return inRange;

  const baseline = [...sorted].reverse().find((point) => point.date < start);
  const baselineAge = baseline
    ? Date.parse(`${start}T00:00:00.000Z`) - Date.parse(`${baseline.date}T00:00:00.000Z`)
    : Number.POSITIVE_INFINITY;
  return baseline && baselineAge <= MAX_OPENING_BASELINE_AGE_MS
    ? [baseline, ...inRange]
    : inRange;
}

export function summarizeNetWorthRange(
  points: NetWorthHistoryPoint[],
): NetWorthRangeSummary {
  if (points.length < 2) return { changeMinor: null, changePercent: null };
  const start = points[0].totalMinor;
  const end = points.at(-1)!.totalMinor;
  const changeMinor = end - start;
  return {
    changeMinor,
    changePercent: start <= 0 ? null : changeMinor / start,
  };
}
