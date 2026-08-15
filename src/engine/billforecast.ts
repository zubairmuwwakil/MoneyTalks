import { amountOn, occurrencesBetween, type Cadence, type ScheduleEntry } from "./recurrence";

export interface BillDef {
  id: string;
  name: string;
  category: string;
  currency: string;
  autopay: boolean;
  variable: boolean;
  cadence: Cadence;
  schedule: ScheduleEntry[];
}

export interface Occurrence {
  billId: string;
  billName: string;
  category: string;
  currency: string;
  autopay: boolean;
  variable: boolean;
  date: string;
  amountMinor: number;
}

export function billOccurrences(bill: BillDef, from: string, to: string): Occurrence[] {
  return occurrencesBetween(bill.cadence, from, to).flatMap((date) => {
    const amountMinor = amountOn(bill.schedule, date);
    if (amountMinor === null) return [];
    return [
      {
        billId: bill.id,
        billName: bill.name,
        category: bill.category,
        currency: bill.currency,
        autopay: bill.autopay,
        variable: bill.variable,
        date,
        amountMinor,
      },
    ];
  });
}

export interface MonthForecast {
  month: string; // YYYY-MM
  occurrences: Occurrence[];
  totalMinor: number;
  cumulativeMinor: number;
  flags: string[];
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

function addMonths(month: string, count: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + count;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/**
 * Totals sum bill amounts at face value: a bill in a non-CAD currency is added
 * as-is, not converted. v1 displays each occurrence in its own currency and
 * assumes a CAD-dominant bill set for the monthly total. Cross-currency totals
 * would need the FxRate table, which is a Phase 5 concern.
 */
export function forecastMonths(
  bills: BillDef[],
  startMonth: string,
  monthsCount: number,
): MonthForecast[] {
  if (monthsCount < 1 || monthsCount > 60) {
    throw new RangeError(`monthsCount must be 1..60, got ${monthsCount}`);
  }
  const result: MonthForecast[] = [];
  let cumulative = 0;

  for (let i = 0; i < monthsCount; i += 1) {
    const month = addMonths(startMonth, i);
    const occurrences = bills
      .flatMap((bill) => billOccurrences(bill, `${month}-01`, monthEnd(month)))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const totalMinor = occurrences.reduce((sum, o) => sum + o.amountMinor, 0);
    cumulative += totalMinor;

    const counts = new Map<string, { name: string; count: number }>();
    for (const o of occurrences) {
      const entry = counts.get(o.billId) ?? { name: o.billName, count: 0 };
      entry.count += 1;
      counts.set(o.billId, entry);
    }
    const flags = [...counts.values()].filter((c) => c.count >= 3).map((c) => `3× ${c.name}`);

    result.push({ month, occurrences, totalMinor, cumulativeMinor: cumulative, flags });
  }
  return result;
}
