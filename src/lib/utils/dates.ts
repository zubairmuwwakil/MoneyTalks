/**
 * UTC day-bucket helpers.
 *
 * These were previously re-declared privately in eventNotificationScheduler.ts,
 * api/events/route.ts and calendarEvents.ts. Duplicated helpers are how the
 * EventType drift happened (see the spec's §2.1), so new code imports from
 * here; the existing copies are consolidated onto it as each of those files is
 * touched rather than in one sweeping change.
 */

export function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDaysUTC(d: Date, days: number) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function toISODateOnlyUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a day-of-month against a real month, clamping overflow to the last
 * day: "the 31st" is Feb 28 in 2026 and Feb 29 in 2028. Day 0 of the following
 * month is the last day of this one.
 */
export function clampDayToMonth(year: number, monthZero: number, day: number) {
  const lastDay = new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
  return Math.min(day, lastDay);
}
