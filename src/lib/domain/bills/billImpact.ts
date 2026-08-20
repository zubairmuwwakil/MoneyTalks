import { billOccurrences, type BillDef } from "@/engine/billforecast";
import { convertMinor, findFxRate, MissingFxRateError, type FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";

export interface BillImpactWeek {
  weekStart: string;
  fixedMinor: number;
  variableMinor: number;
  totalMinor: number;
  occurrenceCount: number;
}

export interface BillImpactView {
  displayCurrency: "CAD";
  startDate: string;
  weeks: BillImpactWeek[];
  totalMinor: number;
  averageMinor: number;
  busiestWeek: BillImpactWeek | null;
  excludedCount: number;
  fxOldestAsOf: string | null;
  fxLatestAsOf: string | null;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const SUPPORTED_CURRENCIES = new Set<Currency>(["CAD", "USD", "JMD"]);

function dayMs(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`startDate must be an ISO date, got ${date}`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new RangeError(`startDate must be an ISO date, got ${date}`);
  return ms;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function mondayStartMs(date: string): number {
  const ms = dayMs(date);
  const day = new Date(ms).getUTCDay();
  return ms - (day === 0 ? 6 : day - 1) * DAY_MS;
}

function convertOccurrence(
  amountMinor: number,
  sourceCurrency: string,
  rates: FxRateInput[],
): { amountMinor: number; fxAsOf: string | null } | null {
  if (!SUPPORTED_CURRENCIES.has(sourceCurrency as Currency)) return null;
  try {
    const from = sourceCurrency as Currency;
    return {
      amountMinor: convertMinor(amountMinor, from, "CAD", rates),
      fxAsOf: from === "CAD" ? null : (findFxRate(rates, from, "CAD")?.rate.asOf ?? null),
    };
  } catch (error) {
    if (error instanceof MissingFxRateError) return null;
    throw error;
  }
}

export function buildBillImpact(
  bills: BillDef[],
  rates: FxRateInput[],
  startDate: string,
  weeksCount = 8,
): BillImpactView {
  if (!Number.isInteger(weeksCount) || weeksCount < 1 || weeksCount > 52) {
    throw new RangeError(`weeksCount must be 1..52, got ${weeksCount}`);
  }

  const firstWeekMs = mondayStartMs(startDate);
  const endDate = toIso(firstWeekMs + weeksCount * WEEK_MS - DAY_MS);
  const weeks: BillImpactWeek[] = Array.from({ length: weeksCount }, (_, index) => ({
    weekStart: toIso(firstWeekMs + index * WEEK_MS),
    fixedMinor: 0,
    variableMinor: 0,
    totalMinor: 0,
    occurrenceCount: 0,
  }));
  let excludedCount = 0;
  const usedFxDates = new Set<string>();

  for (const bill of bills) {
    for (const occurrence of billOccurrences(bill, startDate, endDate)) {
      const conversion = convertOccurrence(occurrence.amountMinor, occurrence.currency, rates);
      if (conversion === null) {
        excludedCount += 1;
        continue;
      }
      const index = Math.floor((mondayStartMs(occurrence.date) - firstWeekMs) / WEEK_MS);
      const week = weeks[index];
      if (!week) continue;
      if (occurrence.variable) week.variableMinor += conversion.amountMinor;
      else week.fixedMinor += conversion.amountMinor;
      week.totalMinor += conversion.amountMinor;
      week.occurrenceCount += 1;
      if (conversion.fxAsOf) usedFxDates.add(conversion.fxAsOf);
    }
  }

  const totalMinor = weeks.reduce((sum, week) => sum + week.totalMinor, 0);
  const busiestWeek = weeks.reduce<BillImpactWeek | null>((busiest, week) => {
    if (week.totalMinor === 0) return busiest;
    if (!busiest || week.totalMinor > busiest.totalMinor) return week;
    return busiest;
  }, null);
  const orderedFxDates = [...usedFxDates].sort();

  return {
    displayCurrency: "CAD",
    startDate,
    weeks,
    totalMinor,
    averageMinor: Math.round(totalMinor / weeksCount),
    busiestWeek,
    excludedCount,
    fxOldestAsOf: orderedFxDates[0] ?? null,
    fxLatestAsOf: orderedFxDates.at(-1) ?? null,
  };
}
