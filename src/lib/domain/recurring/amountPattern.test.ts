import { describe, expect, it } from "vitest";
import { amountOn } from "@/engine/recurrence";
import { inferAmountPattern } from "./amountPattern";
import type { Observation } from "./types";

function observations(amounts: readonly number[], currency = "CAD"): Observation[] {
  return amounts.map((amountMinor, index) => ({
    amountMinor,
    currency,
    date: new Date(Date.UTC(2025, index, 15, 12)),
  }));
}

describe("inferAmountPattern fixtures", () => {
  it.each([
    { name: "netflix-monthly", amounts: [2_099, 2_099, 2_099], pattern: "FIXED" },
    { name: "domain-annual", amounts: [1_899, 1_899, 1_899], pattern: "FIXED" },
    { name: "utility-variable", amounts: [8_200, 10_500, 9_400], pattern: "VARIABLE" },
    { name: "usage-based-vercel", amounts: [400, 2_000, 1_200], pattern: "USAGE_BASED" },
  ] as const)("classifies $name", ({ amounts, pattern }) => {
    expect(inferAmountPattern(observations(amounts)).pattern).toBe(pattern);
  });

  it("models a price increase as two fixed schedule rows, not variance", () => {
    const result = inferAmountPattern(observations([
      1_599, 1_599, 1_599, 1_599, 1_599, 1_599,
      1_799, 1_799, 1_799, 1_799, 1_799, 1_799,
    ], "USD"));

    expect(result).toEqual({
      pattern: "FIXED",
      schedule: [
        { from: "2025-01-15", to: "2025-07-14", amountMinor: 1_599 },
        { from: "2025-07-15", amountMinor: 1_799 },
      ],
    });
    expect(amountOn(result.schedule, "2025-05-01")).toBe(1_599);
    expect(amountOn(result.schedule, "2025-09-01")).toBe(1_799);
  });

  it("detects more than one conservative stable price step", () => {
    const result = inferAmountPattern(observations([
      1_000, 1_000, 1_000,
      1_200, 1_200, 1_200,
      1_500, 1_500, 1_500,
    ]));

    expect(result.pattern).toBe("FIXED");
    expect(result.schedule.map((entry) => entry.amountMinor)).toEqual([1_000, 1_200, 1_500]);
  });

  it("does not invent changepoints for a genuinely variable bill", () => {
    const result = inferAmountPattern(observations([8_200, 10_500, 9_400, 9_900, 8_700, 10_100]));

    expect(result.pattern).toBe("VARIABLE");
    expect(result.schedule).toHaveLength(1);
  });

  it("rejects mixed currencies before comparing amounts", () => {
    const mixed: Observation[] = [
      { date: new Date("2026-01-01T12:00:00Z"), amountMinor: 1_000, currency: "CAD" },
      { date: new Date("2026-02-01T12:00:00Z"), amountMinor: 1_000, currency: "USD" },
    ];

    expect(() => inferAmountPattern(mixed)).toThrow(/one currency/);
  });

  it("is invariant to input ordering", () => {
    const ordered = observations([1_599, 1_599, 1_599, 1_799, 1_799, 1_799]);
    expect(inferAmountPattern([...ordered].reverse())).toEqual(inferAmountPattern(ordered));
  });
});

describe("unpriced series", () => {
  // Cloudflare's "Your invoice is available" puts the figure behind a link, so
  // the observation arrives dated but unpriced. The cadence is still real.
  const monthly = (day: string) => new Date(`2026-0${day}-11T00:00:00.000Z`);

  it("classifies an entirely unpriced series as UNKNOWN with no schedule", () => {
    const result = inferAmountPattern([
      { date: monthly("1"), amountMinor: null, currency: null },
      { date: monthly("2"), amountMinor: null, currency: null },
      { date: monthly("3"), amountMinor: null, currency: null },
    ]);
    expect(result.pattern).toBe("UNKNOWN");
    expect(result.schedule).toEqual([]);
  });

  it("uses the priced observations when only some carry an amount", () => {
    // Partial information is still information — a biller that started
    // stating amounts should not be treated as if it never had.
    const result = inferAmountPattern([
      { date: monthly("1"), amountMinor: null, currency: "CAD" },
      { date: monthly("2"), amountMinor: 2099, currency: "CAD" },
      { date: monthly("3"), amountMinor: 2099, currency: "CAD" },
    ]);
    expect(result.pattern).toBe("FIXED");
    expect(result.schedule[0].amountMinor).toBe(2099);
  });

  it("still rejects an empty series", () => {
    expect(() => inferAmountPattern([])).toThrow(RangeError);
  });
});
