import { convertMinor, type FxRateInput } from "./fx";
import type { Currency } from "./money";

export interface AccountBalanceRow {
  id: string;
  name: string;
  type: string;
  currency: Currency;
  balanceMinor: number;
}

export function netWorth(
  rows: AccountBalanceRow[],
  display: Currency,
  rates: FxRateInput[],
): { totalMinor: number; perAccount: Array<AccountBalanceRow & { displayMinor: number }> } {
  const perAccount = rows.map((row) => ({
    ...row,
    displayMinor: convertMinor(row.balanceMinor, row.currency, display, rates),
  }));
  return {
    totalMinor: perAccount.reduce((sum, r) => sum + r.displayMinor, 0),
    perAccount,
  };
}

export interface SnapshotRow {
  accountId: string;
  balanceMinor: number;
  currency: Currency;
  asOf: string; // ISO 8601
}

function toUtcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function dayToIso(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function netWorthSeries(
  snapshots: SnapshotRow[],
  display: Currency,
  rates: FxRateInput[],
  fromDate: string,
  toDate: string,
): Array<{ date: string; totalMinor: number }> {
  const from = toUtcDay(fromDate);
  const to = toUtcDay(toDate);
  if (from > to) return [];

  const byAccount = new Map<string, SnapshotRow[]>();
  for (const snap of snapshots) {
    const list = byAccount.get(snap.accountId) ?? [];
    list.push(snap);
    byAccount.set(snap.accountId, list);
  }
  for (const list of byAccount.values()) {
    list.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
  }

  const series: Array<{ date: string; totalMinor: number }> = [];
  for (let day = from; day <= to; day += DAY_MS) {
    const date = dayToIso(day);
    let totalMinor = 0;
    for (const list of byAccount.values()) {
      let current: SnapshotRow | undefined;
      for (const snap of list) {
        if (toUtcDay(snap.asOf) <= day) current = snap;
        else break;
      }
      if (current) {
        totalMinor += convertMinor(current.balanceMinor, current.currency, display, rates);
      }
    }
    series.push({ date, totalMinor });
  }
  return series;
}
