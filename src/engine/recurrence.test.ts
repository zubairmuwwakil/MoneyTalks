import { describe, expect, it } from "vitest";
import { amountOn, occurrencesBetween, type Cadence, type ScheduleEntry } from "./recurrence";

describe("amountOn — the effective-dated amount pattern", () => {
  // Modeled on a promo that steps up twice (fictional amounts)
  const stepped: ScheduleEntry[] = [
    { from: "2025-09-01", to: "2026-08-31", amountMinor: 1000 },
    { from: "2026-09-01", to: "2027-08-31", amountMinor: 1500 },
    { from: "2027-09-01", amountMinor: 2000 },
  ];

  it("resolves each step by date range, inclusive on both ends", () => {
    expect(amountOn(stepped, "2026-08-31")).toBe(1000);
    expect(amountOn(stepped, "2026-09-01")).toBe(1500);
    expect(amountOn(stepped, "2027-08-31")).toBe(1500);
    expect(amountOn(stepped, "2027-09-01")).toBe(2000);
    expect(amountOn(stepped, "2030-01-01")).toBe(2000); // open-ended tail
  });

  it("returns null before the first entry", () => {
    expect(amountOn(stepped, "2025-08-31")).toBeNull();
  });

  it("on overlap, the latest 'from' wins", () => {
    const overlapping: ScheduleEntry[] = [
      { from: "2026-01-01", amountMinor: 100 },
      { from: "2026-06-01", amountMinor: 200 },
    ];
    expect(amountOn(overlapping, "2026-07-01")).toBe(200);
    expect(amountOn(overlapping, "2026-03-01")).toBe(100);
  });
});

describe("occurrencesBetween — BIWEEKLY", () => {
  const biweekly: Cadence = { type: "BIWEEKLY", anchor: "2026-01-07" }; // a Wednesday

  it("produces exactly 26 payments in 2026", () => {
    expect(occurrencesBetween(biweekly, "2026-01-01", "2026-12-31")).toHaveLength(26);
  });

  it("lands on 14-day steps from the anchor", () => {
    const dates = occurrencesBetween(biweekly, "2026-01-01", "2026-02-28");
    expect(dates).toEqual(["2026-01-07", "2026-01-21", "2026-02-04", "2026-02-18"]);
  });

  it("April and September 2026 are the triple-payment months for this anchor", () => {
    expect(occurrencesBetween(biweekly, "2026-04-01", "2026-04-30")).toEqual([
      "2026-04-01", "2026-04-15", "2026-04-29",
    ]);
    expect(occurrencesBetween(biweekly, "2026-09-01", "2026-09-30")).toEqual([
      "2026-09-02", "2026-09-16", "2026-09-30",
    ]);
  });

  it("works when the window starts long after the anchor", () => {
    expect(occurrencesBetween(biweekly, "2027-01-01", "2027-01-31")).toEqual([
      "2027-01-06", "2027-01-20",
    ]);
  });
});

describe("occurrencesBetween — WEEKLY", () => {
  const weekly: Cadence = { type: "WEEKLY", anchor: "2026-01-07" }; // a Wednesday

  it("steps every 7 days in a window after the anchor", () => {
    expect(occurrencesBetween(weekly, "2026-02-01", "2026-02-28")).toEqual([
      "2026-02-04", "2026-02-11", "2026-02-18", "2026-02-25",
    ]);
  });

  it("steps backwards through a window before the anchor", () => {
    const futureAnchor: Cadence = { type: "WEEKLY", anchor: "2026-10-07" };
    expect(occurrencesBetween(futureAnchor, "2026-09-01", "2026-09-30")).toEqual([
      "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30",
    ]);
  });

  it("keeps the grid continuous in a window straddling the anchor", () => {
    expect(occurrencesBetween(weekly, "2025-12-30", "2026-01-12")).toEqual([
      "2025-12-31", "2026-01-07",
    ]);
  });
});

describe("occurrencesBetween — MONTHLY", () => {
  it("clamps dayOfMonth to short months", () => {
    const eom: Cadence = { type: "MONTHLY", dayOfMonth: 31 };
    expect(occurrencesBetween(eom, "2026-02-01", "2026-04-30")).toEqual([
      "2026-02-28", "2026-03-31", "2026-04-30", // 2026 is not a leap year
    ]);
  });

  it("respects startsFrom and activeMonths (the property-tax instalment pattern)", () => {
    const instalments: Cadence = {
      type: "MONTHLY",
      dayOfMonth: 1,
      startsFrom: "2027-02-01",
      activeMonths: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    };
    expect(occurrencesBetween(instalments, "2026-01-01", "2026-12-31")).toEqual([]);
    const in2027 = occurrencesBetween(instalments, "2027-01-01", "2027-12-31");
    expect(in2027).toHaveLength(11); // Feb–Dec, no January
    expect(in2027[0]).toBe("2027-02-01");
    expect(in2027[10]).toBe("2027-12-01");
  });
});

describe("occurrencesBetween — QUARTERLY and ANNUAL", () => {
  it("steps quarterly in 3-month jumps with day clamping", () => {
    const q: Cadence = { type: "QUARTERLY", anchor: "2026-11-30" };
    expect(occurrencesBetween(q, "2026-11-01", "2027-06-30")).toEqual([
      "2026-11-30", "2027-02-28", "2027-05-30",
    ]);
  });

  it("steps annually", () => {
    const a: Cadence = { type: "ANNUAL", anchor: "2026-03-15" };
    expect(occurrencesBetween(a, "2026-01-01", "2028-12-31")).toEqual([
      "2026-03-15", "2027-03-15", "2028-03-15",
    ]);
  });
});

describe("occurrencesBetween — SEMIANNUAL", () => {
  const semiannual: Cadence = { type: "SEMIANNUAL", anchor: "2026-01-15" };

  it("steps every 6 months in a window after the anchor", () => {
    expect(occurrencesBetween(semiannual, "2026-02-01", "2027-12-31")).toEqual([
      "2026-07-15", "2027-01-15", "2027-07-15",
    ]);
  });

  it("steps backwards through a window before the anchor", () => {
    const futureAnchor: Cadence = { type: "SEMIANNUAL", anchor: "2027-01-20" };
    expect(occurrencesBetween(futureAnchor, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-20", "2026-07-20",
    ]);
  });

  it("keeps the grid continuous in a window straddling the anchor", () => {
    expect(occurrencesBetween(semiannual, "2025-10-01", "2026-02-01")).toEqual([
      "2026-01-15",
    ]);
  });

  it("clamps a 31st anchor in short months", () => {
    const eom: Cadence = { type: "SEMIANNUAL", anchor: "2026-08-31" };
    expect(occurrencesBetween(eom, "2026-08-01", "2027-09-01")).toEqual([
      "2026-08-31", "2027-02-28", "2027-08-31",
    ]);
  });
});

describe("bounds", () => {
  it("throws on windows over 60 months or inverted ranges", () => {
    const m: Cadence = { type: "MONTHLY", dayOfMonth: 1 };
    expect(() => occurrencesBetween(m, "2026-01-01", "2031-02-01")).toThrow(RangeError);
    expect(() => occurrencesBetween(m, "2026-02-01", "2026-01-01")).toThrow(RangeError);
  });
});

describe("windows that begin before the anchor", () => {
  // The anchor is "any one known payment date", past or future. A window that
  // starts before it must still be filled: otherwise a bill anchored to next
  // month reports nothing due for every month of its history.
  it("biweekly steps backwards from a future anchor", () => {
    const c: Cadence = { type: "BIWEEKLY", anchor: "2026-10-07" };
    // Stepping back 14 at a time from October lands three times in July.
    expect(occurrencesBetween(c, "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-01", "2026-07-15", "2026-07-29",
    ]);
    // Straddling the anchor, the grid stays continuous across it.
    expect(occurrencesBetween(c, "2026-09-20", "2026-10-08")).toEqual(["2026-09-23", "2026-10-07"]);
  });

  it("quarterly steps backwards from a future anchor", () => {
    const c: Cadence = { type: "QUARTERLY", anchor: "2027-01-20" };
    expect(occurrencesBetween(c, "2026-10-01", "2026-10-31")).toEqual(["2026-10-20"]);
    expect(occurrencesBetween(c, "2026-04-01", "2027-01-20")).toEqual([
      "2026-04-20", "2026-07-20", "2026-10-20", "2027-01-20",
    ]);
  });

  it("annual steps backwards from a future anchor", () => {
    const c: Cadence = { type: "ANNUAL", anchor: "2029-11-08" };
    expect(occurrencesBetween(c, "2026-01-01", "2026-12-31")).toEqual(["2026-11-08"]);
  });
});
