import { describe, expect, it } from "vitest";
import { addMonthsUTC, buildMonthGrid, daysBetweenISO, gridRangeISO, startOfMonthUTC } from "./monthGrid";

describe("startOfMonthUTC", () => {
  it("normalizes any day in the month to day 1 at UTC midnight", () => {
    const d = startOfMonthUTC(new Date(Date.UTC(2026, 2, 17, 13, 45)));
    expect(d.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("addMonthsUTC", () => {
  it("returns the same month for delta 0", () => {
    const d = addMonthsUTC(new Date(Date.UTC(2026, 2, 1)), 0);
    expect(d.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("carries a positive delta across a year boundary", () => {
    const d = addMonthsUTC(new Date(Date.UTC(2026, 11, 1)), 1);
    expect(d.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("carries a negative delta across a year boundary", () => {
    const d = addMonthsUTC(new Date(Date.UTC(2026, 0, 1)), -1);
    expect(d.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });

  it("lands on the same month one year later for delta 12", () => {
    const d = addMonthsUTC(new Date(Date.UTC(2026, 2, 1)), 12);
    expect(d.toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });
});

describe("buildMonthGrid", () => {
  it("always returns a fixed 42-cell (6-week) grid", () => {
    // March 2026 (31 days) and February 2026 (28 days) both must pad to 42.
    expect(buildMonthGrid(new Date(Date.UTC(2026, 2, 1)))).toHaveLength(42);
    expect(buildMonthGrid(new Date(Date.UTC(2026, 1, 1)))).toHaveLength(42);
  });

  it("starts the grid on a Sunday and ends on a Saturday", () => {
    const cells = buildMonthGrid(new Date(Date.UTC(2026, 2, 1)));
    expect(cells[0].date.getUTCDay()).toBe(0);
    expect(cells[41].date.getUTCDay()).toBe(6);
  });

  it("contains 42 consecutive calendar days with no gaps or repeats", () => {
    const cells = buildMonthGrid(new Date(Date.UTC(2026, 2, 1)));
    for (let i = 1; i < cells.length; i++) {
      const prev = cells[i - 1].date.getTime();
      const cur = cells[i].date.getTime();
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it("marks exactly the days belonging to the target month as inMonth", () => {
    const cells = buildMonthGrid(new Date(Date.UTC(2026, 1, 1))); // Feb 2026 = 28 days
    const inMonthCells = cells.filter((c) => c.inMonth);
    expect(inMonthCells).toHaveLength(28);
    expect(inMonthCells[0].date.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(inMonthCells[27].date.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("normalizes an arbitrary day-of-month input to that month's grid", () => {
    const cells = buildMonthGrid(new Date(Date.UTC(2026, 2, 17)));
    const inMonthCells = cells.filter((c) => c.inMonth);
    expect(inMonthCells[0].date.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("gridRangeISO", () => {
  it("spans exactly the 42 grid cells as a half-open [start, end) range", () => {
    const cells = buildMonthGrid(new Date(Date.UTC(2026, 2, 1)));
    const { start, end } = gridRangeISO(new Date(Date.UTC(2026, 2, 1)));
    expect(start).toBe(cells[0].date.toISOString().slice(0, 10));
    const dayAfterLast = new Date(cells[41].date.getTime() + 86_400_000);
    expect(end).toBe(dayAfterLast.toISOString().slice(0, 10));
  });
});

describe("daysBetweenISO", () => {
  it("is zero for the same date", () => {
    expect(daysBetweenISO("2026-03-15", "2026-03-15")).toBe(0);
  });

  it("is positive when the second date is later", () => {
    expect(daysBetweenISO("2026-03-15", "2026-03-16")).toBe(1);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetweenISO("2026-03-16", "2026-03-15")).toBe(-1);
  });

  it("crosses a month boundary correctly", () => {
    expect(daysBetweenISO("2026-02-27", "2026-03-01")).toBe(2);
  });

  it("crosses a year boundary correctly", () => {
    expect(daysBetweenISO("2025-12-31", "2026-01-01")).toBe(1);
  });
});
