import { describe, expect, it } from "vitest";
import { currentFeeCycle, type FeeScheduleCard } from "./feeSchedule";
import type { CardDef } from "./types";

/** UTC midnight, so tests never depend on the machine's timezone. */
function utc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

const baseCard: CardDef = {
  id: "alpha",
  nickname: "Fixture Alpha Amex",
  network: "AMEX",
  annualFeeMinor: 15_000,
  rewards: {
    pointValueCents: 1.2,
    fxFeePct: 2.5,
    baseMultiplier: 1,
    categoryRates: [],
    credits: [],
  },
};

function card(overrides: Partial<FeeScheduleCard> = {}): FeeScheduleCard {
  return { ...baseCard, feeMonthDay: "03-15", feeCancelGraceDays: 30, ...overrides };
}

describe("currentFeeCycle — the phase boundaries from the spec table", () => {
  it("is UPCOMING before the fee posts", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 3, 3));
    expect(cycle).not.toBeNull();
    expect(cycle!.phase).toBe("UPCOMING");
    expect(cycle!.postsOn).toEqual(utc(2026, 3, 15));
    expect(cycle!.cancelBy).toEqual(utc(2026, 4, 14));
    expect(cycle!.feeMinor).toBe(15_000);
  });

  it("enters DECISION_WINDOW on the day the fee posts", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 3, 15));
    expect(cycle!.phase).toBe("DECISION_WINDOW");
    expect(cycle!.postsOn).toEqual(utc(2026, 3, 15));
  });

  it("is still DECISION_WINDOW on the last day of the grace window", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 4, 14));
    expect(cycle!.phase).toBe("DECISION_WINDOW");
    expect(cycle!.cancelBy).toEqual(utc(2026, 4, 14));
  });

  it("rolls to next year's cycle the day after the grace window closes", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 4, 15));
    expect(cycle!.phase).toBe("UPCOMING");
    expect(cycle!.postsOn).toEqual(utc(2027, 3, 15));
    expect(cycle!.cancelBy).toEqual(utc(2027, 4, 14));
  });
});

describe("currentFeeCycle — grace windows that cross New Year", () => {
  it("stays in the previous year's DECISION_WINDOW in early January", () => {
    // Fee posts 2026-12-20, grace runs to 2027-01-19. On 2027-01-05 the user
    // is mid-decision on the 2026 cycle — resolving the anniversary only in
    // the current or next year would skip to 2027-12-20 and hide the deadline.
    const cycle = currentFeeCycle(card({ feeMonthDay: "12-20" }), utc(2027, 1, 5));
    expect(cycle!.phase).toBe("DECISION_WINDOW");
    expect(cycle!.postsOn).toEqual(utc(2026, 12, 20));
    expect(cycle!.cancelBy).toEqual(utc(2027, 1, 19));
  });

  it("rolls to the current year's cycle once that window closes", () => {
    const cycle = currentFeeCycle(card({ feeMonthDay: "12-20" }), utc(2027, 1, 20));
    expect(cycle!.phase).toBe("UPCOMING");
    expect(cycle!.postsOn).toEqual(utc(2027, 12, 20));
  });
});

describe("currentFeeCycle — month-day resolution", () => {
  it("clamps 02-30 to the last day of February in a non-leap year", () => {
    const cycle = currentFeeCycle(card({ feeMonthDay: "02-30" }), utc(2026, 1, 1));
    expect(cycle!.postsOn).toEqual(utc(2026, 2, 28));
  });

  it("clamps 02-30 to February 29 in a leap year", () => {
    const cycle = currentFeeCycle(card({ feeMonthDay: "02-30" }), utc(2028, 1, 1));
    expect(cycle!.postsOn).toEqual(utc(2028, 2, 29));
  });

  it("keeps 02-29 on the 29th in a leap year", () => {
    const cycle = currentFeeCycle(card({ feeMonthDay: "02-29" }), utc(2028, 1, 1));
    expect(cycle!.postsOn).toEqual(utc(2028, 2, 29));
  });

  it("clamps 02-29 back to the 28th in a non-leap year", () => {
    const cycle = currentFeeCycle(card({ feeMonthDay: "02-29" }), utc(2026, 1, 1));
    expect(cycle!.postsOn).toEqual(utc(2026, 2, 28));
  });
});

describe("currentFeeCycle — when there is no decision to surface", () => {
  it("returns null when the renewal date is unknown", () => {
    expect(currentFeeCycle(card({ feeMonthDay: null }), utc(2026, 3, 3))).toBeNull();
  });

  it("returns null for a card with no annual fee", () => {
    expect(currentFeeCycle(card({ annualFeeMinor: 0 }), utc(2026, 3, 3))).toBeNull();
  });

  it("returns null when an active waiver reduces the fee to zero", () => {
    const waived = card({
      rewards: {
        ...baseCard.rewards,
        conditions: [{ id: "waiver", label: "Employer waiver", enabled: true, annualFeeReductionMinor: 15_000 }],
      },
    });
    expect(currentFeeCycle(waived, utc(2026, 3, 3))).toBeNull();
  });

  it("still returns a cycle when the waiver is not enabled", () => {
    const notWaived = card({
      rewards: {
        ...baseCard.rewards,
        conditions: [{ id: "waiver", label: "Employer waiver", enabled: false, annualFeeReductionMinor: 15_000 }],
      },
    });
    expect(currentFeeCycle(notWaived, utc(2026, 3, 3))!.feeMinor).toBe(15_000);
  });

  it("reports the reduced fee when a partial waiver is active", () => {
    const partial = card({
      rewards: {
        ...baseCard.rewards,
        conditions: [{ id: "waiver", label: "Partial waiver", enabled: true, annualFeeReductionMinor: 5_000 }],
      },
    });
    expect(currentFeeCycle(partial, utc(2026, 3, 3))!.feeMinor).toBe(10_000);
  });
});

describe("currentFeeCycle — grace window sizes", () => {
  it("collapses DECISION_WINDOW to the posting day when the grace is zero", () => {
    const zeroGrace = card({ feeCancelGraceDays: 0 });
    expect(currentFeeCycle(zeroGrace, utc(2026, 3, 15))!.phase).toBe("DECISION_WINDOW");
    expect(currentFeeCycle(zeroGrace, utc(2026, 3, 16))!.postsOn).toEqual(utc(2027, 3, 15));
  });

  it("ignores the time of day on the caller's clock", () => {
    const lateInDay = new Date(Date.UTC(2026, 2, 15, 23, 59, 59));
    expect(currentFeeCycle(card(), lateInDay)!.phase).toBe("DECISION_WINDOW");
  });
});
