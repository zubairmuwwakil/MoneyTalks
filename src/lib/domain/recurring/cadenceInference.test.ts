import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { inferCadence } from "./cadenceInference";

const DAY_MS = 86_400_000;

function utcDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

function daysFrom(start: Date, offsets: readonly number[]): Date[] {
  return offsets.map((offset) => new Date(start.getTime() + offset * DAY_MS));
}

describe("inferCadence fixtures", () => {
  const fixtures: Array<{
    name: string;
    dates: Date[];
    type: NonNullable<ReturnType<typeof inferCadence>>["cadence"]["type"];
  }> = [
    {
      name: "netflix-monthly",
      dates: ["2026-01-15", "2026-02-14", "2026-03-16", "2026-04-15"].map(utcDate),
      type: "MONTHLY",
    },
    {
      name: "domain-annual",
      dates: ["2023-05-09", "2024-05-08", "2025-05-10", "2026-05-09"].map(utcDate),
      type: "ANNUAL",
    },
    {
      name: "biweekly-mortgage",
      dates: daysFrom(utcDate("2026-01-07"), [0, 14, 28, 42, 56, 70]),
      type: "BIWEEKLY",
    },
    {
      name: "quarterly-water",
      dates: ["2025-10-15", "2026-01-14", "2026-04-15", "2026-07-15"].map(utcDate),
      type: "QUARTERLY",
    },
    {
      name: "semiannual-insurance",
      dates: ["2024-01-15", "2024-07-15", "2025-01-14", "2025-07-15", "2026-01-15"].map(utcDate),
      type: "SEMIANNUAL",
    },
  ];

  it.each(fixtures)("infers $name", ({ dates, type }) => {
    expect(inferCadence(dates, "UTC")?.cadence.type).toBe(type);
  });

  it("returns null for two coincidental charges", () => {
    expect(inferCadence([utcDate("2026-01-01"), utcDate("2026-02-01")], "UTC")).toBeNull();
  });

  it("keeps a clean cadence with one skipped occurrence", () => {
    const result = inferCadence(
      ["2026-01-15", "2026-02-14", "2026-04-15", "2026-05-15", "2026-06-14"].map(utcDate),
      "UTC",
    );

    expect(result?.cadence.type).toBe("MONTHLY");
    expect(result?.coverage).toBeCloseTo(5 / 6);
  });

  it("uses the supplied IANA timezone for a monthly day-of-month", () => {
    const lateTorontoCharges = [
      new Date("2026-01-16T04:30:00.000Z"),
      new Date("2026-02-16T04:30:00.000Z"),
      new Date("2026-03-16T03:30:00.000Z"),
      new Date("2026-04-16T03:30:00.000Z"),
    ];

    expect(inferCadence(lateTorontoCharges, "America/Toronto")?.cadence).toEqual({
      type: "MONTHLY",
      dayOfMonth: 15,
    });
    expect(inferCadence(lateTorontoCharges, "UTC")?.cadence).toEqual({
      type: "MONTHLY",
      dayOfMonth: 16,
    });
  });
});

const cadenceCases = [
  { period: 7, tolerance: 2, type: "WEEKLY" },
  { period: 14, tolerance: 4, type: "BIWEEKLY" },
  { period: 30, tolerance: 4, type: "MONTHLY" },
  { period: 91, tolerance: 10, type: "QUARTERLY" },
  { period: 182, tolerance: 10, type: "SEMIANNUAL" },
  { period: 365, tolerance: 10, type: "ANNUAL" },
] as const;

const generatedCadence = fc.integer({ min: 0, max: cadenceCases.length - 1 }).chain((caseIndex) => {
  const cadence = cadenceCases[caseIndex];
  return fc.array(
    fc.integer({ min: -cadence.tolerance, max: cadence.tolerance }),
    { minLength: 2, maxLength: 19 },
  ).map((jitters) => {
    const offsets = [0];
    for (const jitter of jitters) offsets.push(offsets.at(-1)! + cadence.period + jitter);
    return { cadence, dates: daysFrom(utcDate("2020-01-15"), offsets) };
  });
});

describe("inferCadence properties", () => {
  it("infers every candidate period when every generated gap is within tolerance", () => {
    fc.assert(fc.property(generatedCadence, ({ cadence, dates }) => {
      expect(inferCadence(dates, "UTC")?.cadence.type).toBe(cadence.type);
    }), { numRuns: 1_000 });
  });

  it("is invariant to a whole-sequence shift and to input ordering", () => {
    fc.assert(fc.property(
      generatedCadence,
      fc.integer({ min: -2_000, max: 2_000 }),
      ({ dates }, shiftDays) => {
        const baseline = inferCadence(dates, "UTC");
        const shiftedAndReordered = inferCadence(
          [...dates].reverse().map((date) => new Date(date.getTime() + shiftDays * DAY_MS)),
          "UTC",
        );

        expect(shiftedAndReordered?.cadence.type).toBe(baseline?.cadence.type);
        expect(shiftedAndReordered?.coverage).toBeCloseTo(baseline?.coverage ?? 0, 12);
        expect(shiftedAndReordered?.mad).toBeCloseTo(baseline?.mad ?? 0, 12);
      },
    ), { numRuns: 500 });
  });

  it("keeps the seeded Poisson false-positive rate at or below ten percent", () => {
    const uniforms = fc.sample(
      fc.array(fc.integer({ min: 1, max: 999_999 }), { minLength: 23, maxLength: 23 }),
      { numRuns: 1_000, seed: 2_026_08_29 },
    );
    const falsePositives = uniforms.filter((sample) => {
      const offsets = [0];
      for (const uniform of sample) {
        const exponentialGap = Math.max(1, Math.round(-Math.log(uniform / 1_000_000) * 30));
        offsets.push(offsets.at(-1)! + exponentialGap);
      }
      return inferCadence(daysFrom(utcDate("2024-01-01"), offsets), "UTC") !== null;
    }).length;

    // With n=3 explicitly accepted, a zero rate is impossible: a Poisson
    // process occasionally generates three cadence-aligned observations.
    expect(falsePositives / uniforms.length).toBeLessThanOrEqual(0.1);
  });
});
