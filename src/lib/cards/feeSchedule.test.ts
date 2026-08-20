import { describe, expect, it } from "vitest";
import { currentFeeCycle, feeCycleDaysRemaining, type FeeScheduleCard } from "./feeSchedule";
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
  feeRebateMinor: 0,
    contractCardId: null,
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

  // The rebate is the owner's own figure now — what their banking package
  // actually gives them — rather than a number inferred from card rules. The
  // three cases the retired waiver model covered still have to hold.
  it("returns null when the owner's rebate covers the whole fee", () => {
    const waived = card({ annualFeeMinor: 15_000, feeRebateMinor: 15_000 });
    expect(currentFeeCycle(waived, utc(2026, 3, 3))).toBeNull();
  });

  it("still returns a cycle when the owner records no rebate", () => {
    const notWaived = card({ annualFeeMinor: 15_000, feeRebateMinor: 0 });
    expect(currentFeeCycle(notWaived, utc(2026, 3, 3))!.feeMinor).toBe(15_000);
  });

  it("reports the reduced fee when the rebate is partial", () => {
    const partial = card({ annualFeeMinor: 15_000, feeRebateMinor: 5_000 });
    expect(currentFeeCycle(partial, utc(2026, 3, 3))!.feeMinor).toBe(10_000);
  });

  it("never lets an over-stated rebate turn the fee negative", () => {
    const over = card({ annualFeeMinor: 15_000, feeRebateMinor: 99_000 });
    expect(currentFeeCycle(over, utc(2026, 3, 3))).toBeNull();
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

describe("feeCycleDaysRemaining", () => {
  it("counts down to the posting date while UPCOMING", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 3, 3))!;
    expect(feeCycleDaysRemaining(cycle, utc(2026, 3, 3))).toBe(12);
  });

  it("counts down to the cancel deadline once in the DECISION_WINDOW", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 3, 15))!;
    expect(feeCycleDaysRemaining(cycle, utc(2026, 3, 15))).toBe(30);
  });

  it("returns zero on the last day to cancel", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 4, 14))!;
    expect(feeCycleDaysRemaining(cycle, utc(2026, 4, 14))).toBe(0);
  });

  it("ignores the time of day", () => {
    const cycle = currentFeeCycle(card(), utc(2026, 3, 3))!;
    expect(feeCycleDaysRemaining(cycle, new Date(Date.UTC(2026, 2, 3, 18, 30)))).toBe(12);
  });
});
