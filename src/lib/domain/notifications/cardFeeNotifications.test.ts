import { describe, expect, it } from "vitest";
import { planCardFeeNotifications } from "./cardFeeNotifications";
import { currentFeeCycle, type FeeScheduleCard } from "@/lib/cards/feeSchedule";
import type { CardDef } from "@/lib/cards/types";

function utc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

const baseCard: CardDef = {
  id: "card-1",
  nickname: "Amex Cobalt",
  network: "AMEX",
  annualFeeMinor: 15_000,
  rewards: { pointValueCents: 1.2, fxFeePct: 2.5, baseMultiplier: 1, categoryRates: [], credits: [] },
};

const card: FeeScheduleCard = { ...baseCard, feeMonthDay: "03-15", feeCancelGraceDays: 30 };

function plan(today: Date, leadDays = 3) {
  const cycle = currentFeeCycle(card, today)!;
  return planCardFeeNotifications({
    cardId: "card-1",
    nickname: "Amex Cobalt",
    cycle,
    leadDays,
    today,
    currency: "CAD",
  });
}

describe("planCardFeeNotifications", () => {
  it("plans both the posting warning and the cancel deadline while UPCOMING", () => {
    const plans = plan(utc(2026, 3, 1));
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.phase).sort()).toEqual(["cancel", "posts"]);
  });

  it("drops the posting warning once the fee has already posted", () => {
    // In DECISION_WINDOW the anniversary is in the past. Warning that a fee is
    // "about to post" when it already has would be actively misleading, and
    // computeScheduledFor would clamp it to today and fire it immediately.
    const plans = plan(utc(2026, 3, 20));
    expect(plans.map((p) => p.phase)).toEqual(["cancel"]);
  });

  it("gives the two notifications distinct event keys so neither overwrites the other", () => {
    const plans = plan(utc(2026, 3, 1));
    const keys = plans.map((p) => p.eventKey).sort();
    expect(keys).toEqual([
      "cardfee:card-1:cancel:2026-04-14:lead3",
      "cardfee:card-1:posts:2026-03-15:lead3",
    ]);
    expect(new Set(keys).size).toBe(2);
  });

  it("varies the event key by lead days so a preference change reschedules", () => {
    expect(plan(utc(2026, 3, 1), 7)[0].eventKey).toContain(":lead7");
  });

  it("schedules each notification leadDays before its own date", () => {
    const plans = plan(utc(2026, 3, 1));
    const posts = plans.find((p) => p.phase === "posts")!;
    const cancel = plans.find((p) => p.phase === "cancel")!;
    expect(posts.scheduledFor).toEqual(utc(2026, 3, 12));
    expect(cancel.scheduledFor).toEqual(utc(2026, 4, 11));
  });

  it("never schedules into the past — a late-added card notifies today", () => {
    const plans = plan(utc(2026, 3, 14));
    const posts = plans.find((p) => p.phase === "posts")!;
    expect(posts.scheduledFor).toEqual(utc(2026, 3, 14));
  });

  it("puts the recoverable amount and the deadline in the cancel body", () => {
    const cancel = plan(utc(2026, 3, 1)).find((p) => p.phase === "cancel")!;
    expect(cancel.body).toContain("2026-04-14");
    expect(cancel.body).toContain("150");
  });

  it("prefixes sourceId with the card id so stale sweeps can match it", () => {
    for (const p of plan(utc(2026, 3, 1))) {
      expect(p.sourceId.startsWith("card-1:")).toBe(true);
    }
  });

  it("carries the event's own date, not the scheduled date", () => {
    const plans = plan(utc(2026, 3, 1));
    expect(plans.find((p) => p.phase === "posts")!.eventDate).toEqual(utc(2026, 3, 15));
    expect(plans.find((p) => p.phase === "cancel")!.eventDate).toEqual(utc(2026, 4, 14));
  });
});
