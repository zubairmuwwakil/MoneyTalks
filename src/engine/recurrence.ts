export type Cadence =
  | { type: "BIWEEKLY"; anchor: string }
  | { type: "MONTHLY"; dayOfMonth: number; startsFrom?: string; activeMonths?: number[] }
  | { type: "QUARTERLY"; anchor: string }
  | { type: "ANNUAL"; anchor: string };

export interface ScheduleEntry {
  from: string;
  to?: string;
  amountMinor: number;
  note?: string;
}

const DAY_MS = 86_400_000;

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function toMs(date: string): number {
  const { y, m, d } = parse(date);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based; day 0 of next month
}

function clampedDate(y: number, m: number, d: number): string {
  return toIso(Date.UTC(y, m - 1, Math.min(d, daysInMonth(y, m))));
}

export function amountOn(schedule: ScheduleEntry[], date: string): number | null {
  const candidates = schedule.filter(
    (s) => s.from <= date && (s.to === undefined || date <= s.to),
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => (a.from < b.from ? 1 : -1))[0].amountMinor;
}

function monthsBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

export function occurrencesBetween(cadence: Cadence, from: string, to: string): string[] {
  if (from > to) throw new RangeError(`window is inverted: ${from} > ${to}`);
  if (monthsBetween(from, to) > 60) {
    throw new RangeError(`window exceeds 60 months: ${from}..${to}`);
  }

  const out: string[] = [];

  if (cadence.type === "BIWEEKLY") {
    const anchorMs = toMs(cadence.anchor);
    const fromMs = toMs(from);
    // Signed: the anchor is any one known payment date, past or future. A future
    // anchor must still generate the grid backwards through the window, or every
    // month before it reads as "nothing due".
    const steps = Math.ceil((fromMs - anchorMs) / (14 * DAY_MS));
    for (let ms = anchorMs + steps * 14 * DAY_MS; ms <= toMs(to); ms += 14 * DAY_MS) {
      if (ms >= fromMs) out.push(toIso(ms));
    }
    return out;
  }

  if (cadence.type === "MONTHLY") {
    const start = cadence.startsFrom && cadence.startsFrom > from ? cadence.startsFrom : from;
    let { y, m } = parse(start);
    const end = parse(to);
    while (y < end.y || (y === end.y && m <= end.m)) {
      if (!cadence.activeMonths || cadence.activeMonths.includes(m)) {
        const date = clampedDate(y, m, cadence.dayOfMonth);
        if (date >= start && date >= from && date <= to) out.push(date);
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  // QUARTERLY / ANNUAL: month-stepping from the anchor with day clamping.
  // Same rule as biweekly — step back to the window rather than starting at the
  // anchor, so a window entirely before the anchor is not silently empty.
  const stepMonths = cadence.type === "QUARTERLY" ? 3 : 12;
  const anchor = parse(cadence.anchor);
  const start = parse(from);
  const monthsFromAnchor = (start.y - anchor.y) * 12 + (start.m - anchor.m);
  // One step early, so an occurrence landing in the window's first month is kept.
  const firstStep = Math.floor(monthsFromAnchor / stepMonths) - 1;
  let index = anchor.y * 12 + (anchor.m - 1) + firstStep * stepMonths;
  for (let guard = 0; guard < 1000; guard += 1) {
    const date = clampedDate(Math.floor(index / 12), (index % 12) + 1, anchor.d);
    if (date > to) break;
    if (date >= from) out.push(date);
    index += stepMonths;
  }
  return out;
}
