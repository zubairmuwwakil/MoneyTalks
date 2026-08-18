import { addDaysUTC, toISODateOnlyUTC } from "@/lib/utils/dates";

/**
 * Pure month-grid math for the /calendar page. No React, no fetch — the
 * client component owns "what month is selected", this owns "what dates
 * that implies".
 */

export interface CalendarCell {
  date: Date;
  inMonth: boolean;
}

const WEEKS_PER_GRID = 6;
const CELLS_PER_GRID = WEEKS_PER_GRID * 7;

export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** `monthStart` need not already be day 1 — the output always is. */
export function addMonthsUTC(monthStart: Date, delta: number): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + delta, 1));
}

function daysInMonthUTC(monthStart: Date): number {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * A fixed 6-week (42-cell) Sunday-start grid covering `monthStart`'s month,
 * padded with the trailing days of the prior month and leading days of the
 * next so the calendar never reflows height between months.
 */
export function buildMonthGrid(monthStart: Date): CalendarCell[] {
  const first = startOfMonthUTC(monthStart);
  const leading = first.getUTCDay();
  const days = daysInMonthUTC(first);

  const cells: CalendarCell[] = [];
  for (let i = leading; i > 0; i--) {
    cells.push({ date: addDaysUTC(first, -i), inMonth: false });
  }
  for (let day = 0; day < days; day++) {
    cells.push({ date: addDaysUTC(first, day), inMonth: true });
  }
  while (cells.length < CELLS_PER_GRID) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: addDaysUTC(last, 1), inMonth: false });
  }
  return cells;
}

/** Half-open [start, end) ISO bounds spanning exactly the grid's 42 cells. */
export function gridRangeISO(monthStart: Date): { start: string; end: string } {
  const cells = buildMonthGrid(monthStart);
  const first = cells[0].date;
  const last = cells[cells.length - 1].date;
  return { start: toISODateOnlyUTC(first), end: toISODateOnlyUTC(addDaysUTC(last, 1)) };
}

function parseISODateOnlyUTC(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Whole days from `fromISO` to `toISO`; negative when `toISO` is earlier. */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const ms = parseISODateOnlyUTC(toISO).getTime() - parseISODateOnlyUTC(fromISO).getTime();
  return Math.round(ms / 86_400_000);
}
