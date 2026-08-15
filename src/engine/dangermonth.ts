import type { IncomeSource } from "./rules/types";
import { occurrencesBetween } from "./recurrence";

export interface CashEvent {
  date: string;
  amountMinor: number;
  label: string;
}

const DAY_MS = 86_400_000;

function toMs(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function projectDailyBalance(
  startMinor: number,
  events: CashEvent[],
  from: string,
  to: string,
): Array<{ date: string; balanceMinor: number }> {
  const fromMs = toMs(from);
  const toLimit = toMs(to);
  if (fromMs > toLimit) throw new RangeError("inverted window");
  if ((toLimit - fromMs) / DAY_MS > 1830) throw new RangeError("window exceeds 60 months");

  const byDate = new Map<string, number>();
  for (const event of events) {
    byDate.set(event.date, (byDate.get(event.date) ?? 0) + event.amountMinor);
  }

  const series: Array<{ date: string; balanceMinor: number }> = [];
  let balance = startMinor;
  for (let ms = fromMs; ms <= toLimit; ms += DAY_MS) {
    const date = toIso(ms);
    balance += byDate.get(date) ?? 0;
    series.push({ date, balanceMinor: balance });
  }
  return series;
}

export function dangerMonths(
  series: Array<{ date: string; balanceMinor: number }>,
  cushionMinor: number,
): Array<{ month: string; minBalanceMinor: number; minDate: string }> {
  const byMonth = new Map<string, { minBalanceMinor: number; minDate: string }>();
  for (const point of series) {
    const month = point.date.slice(0, 7);
    const current = byMonth.get(month);
    if (!current || point.balanceMinor < current.minBalanceMinor) {
      byMonth.set(month, { minBalanceMinor: point.balanceMinor, minDate: point.date });
    }
  }
  const threshold = Math.max(cushionMinor, 0);
  return [...byMonth.entries()]
    .filter(([, v]) => v.minBalanceMinor < threshold || v.minBalanceMinor < 0)
    .map(([month, v]) => ({ month, ...v }));
}

export function incomeEvents(sources: IncomeSource[], from: string, to: string): CashEvent[] {
  return sources.flatMap((source) => {
    if (source.cadence === "MONTHLY") {
      return occurrencesBetween({ type: "MONTHLY", dayOfMonth: 1 }, from, to).map((date) => ({
        date,
        amountMinor: source.amountMinor,
        label: source.name,
      }));
    }
    if (source.cadence === "BIWEEKLY") {
      return occurrencesBetween({ type: "BIWEEKLY", anchor: from }, from, to).map((date) => ({
        date,
        amountMinor: source.amountMinor,
        label: source.name,
      }));
    }
    return occurrencesBetween({ type: "ANNUAL", anchor: `${from.slice(0, 4)}-01-01` }, from, to).map(
      (date) => ({ date, amountMinor: source.amountMinor, label: source.name }),
    );
  });
}
