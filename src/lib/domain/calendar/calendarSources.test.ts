import { describe, expect, it } from "vitest";
import { buildBillEvents, buildCardFeeEvents, type BillSource, type BillPaymentRow } from "./calendarSources";
import type { FeeScheduleCard } from "@/lib/cards/feeSchedule";
import type { CardDef } from "@/lib/cards/types";

const WINDOW = { start: "2026-03-01", end: "2026-04-01" };

function bill(overrides: Partial<BillSource> = {}): BillSource {
  return {
    id: "bill-1",
    name: "Hydro",
    currency: "CAD",
    autopay: false,
    cadence: { type: "MONTHLY", dayOfMonth: 15 },
    schedule: [{ from: "2026-01-01", amountMinor: 8_420 }],
    ...overrides,
  };
}

describe("buildBillEvents", () => {
  it("emits one BILL_DUE per occurrence inside the window", () => {
    const events = buildBillEvents([bill()], [], WINDOW.start, WINDOW.end);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("BILL_DUE");
    expect(events[0].date).toBe("2026-03-15");
    expect(events[0].title).toBe("Hydro");
    expect(events[0].amountCents).toBe(8_420);
    expect(events[0].source).toEqual({ kind: "bill", sourceId: "bill-1" });
  });

  it("excludes the window's end date, matching the existing half-open convention", () => {
    const onEndDate = bill({ cadence: { type: "MONTHLY", dayOfMonth: 1 } });
    const events = buildBillEvents([onEndDate], [], WINDOW.start, WINDOW.end);
    expect(events.map((e) => e.date)).toEqual(["2026-03-01"]);
  });

  it("marks an occurrence PAID when a Payment for that date has paidAt", () => {
    const payments: BillPaymentRow[] = [
      { billId: "bill-1", dueDate: new Date(Date.UTC(2026, 2, 15)), paidAt: new Date(Date.UTC(2026, 2, 14)) },
    ];
    const events = buildBillEvents([bill()], payments, WINDOW.start, WINDOW.end);
    expect(events[0].billStatus).toBe("PAID");
  });

  it("marks it DUE when a Payment row exists but is unpaid", () => {
    const payments: BillPaymentRow[] = [
      { billId: "bill-1", dueDate: new Date(Date.UTC(2026, 2, 15)), paidAt: null },
    ];
    expect(buildBillEvents([bill()], payments, WINDOW.start, WINDOW.end)[0].billStatus).toBe("DUE");
  });

  it("marks it DUE when no Payment row exists at all", () => {
    // Payment rows are only created when the user marks a bill paid, so the
    // common case for a future occurrence is no row.
    expect(buildBillEvents([bill()], [], WINDOW.start, WINDOW.end)[0].billStatus).toBe("DUE");
  });

  it("does not let another bill's payment mark this one paid", () => {
    const payments: BillPaymentRow[] = [
      { billId: "bill-2", dueDate: new Date(Date.UTC(2026, 2, 15)), paidAt: new Date(Date.UTC(2026, 2, 14)) },
    ];
    expect(buildBillEvents([bill()], payments, WINDOW.start, WINDOW.end)[0].billStatus).toBe("DUE");
  });

  it("carries autopay through", () => {
    expect(buildBillEvents([bill({ autopay: true })], [], WINDOW.start, WINDOW.end)[0].autopay).toBe(true);
  });

  it("skips occurrences with no scheduled amount rather than showing zero", () => {
    const lapsed = bill({ schedule: [{ from: "2026-01-01", to: "2026-02-01", amountMinor: 8_420 }] });
    expect(buildBillEvents([lapsed], [], WINDOW.start, WINDOW.end)).toEqual([]);
  });

  it("gives each occurrence a stable id keyed by bill and date", () => {
    const first = buildBillEvents([bill()], [], WINDOW.start, WINDOW.end);
    const second = buildBillEvents([bill()], [], WINDOW.start, WINDOW.end);
    expect(first[0].id).toBe("bill_bill-1_2026-03-15");
    expect(second[0].id).toBe(first[0].id);
  });
});

const baseCard: CardDef = {
  id: "card-1",
  nickname: "Amex Cobalt",
  network: "AMEX",
  annualFeeMinor: 15_000,
  feeRebateMinor: 0,
    contractCardId: null,
};

function feeCard(overrides: Partial<FeeScheduleCard> = {}): FeeScheduleCard {
  return { ...baseCard, feeMonthDay: "03-15", feeCancelGraceDays: 30, ...overrides };
}

describe("buildCardFeeEvents", () => {
  it("emits CARD_FEE_POSTS when the anniversary falls in the window", () => {
    const events = buildCardFeeEvents([feeCard()], WINDOW.start, WINDOW.end, new Date(Date.UTC(2026, 2, 1)));
    const posts = events.find((e) => e.type === "CARD_FEE_POSTS");
    expect(posts).toBeDefined();
    expect(posts!.date).toBe("2026-03-15");
    expect(posts!.amountCents).toBe(15_000);
    expect(posts!.source).toEqual({ kind: "card", sourceId: "card-1" });
  });

  it("emits CARD_FEE_CANCEL_BY in the window that contains the deadline", () => {
    const events = buildCardFeeEvents([feeCard()], "2026-04-01", "2026-05-01", new Date(Date.UTC(2026, 3, 1)));
    const cancel = events.find((e) => e.type === "CARD_FEE_CANCEL_BY");
    expect(cancel).toBeDefined();
    expect(cancel!.date).toBe("2026-04-14");
  });

  it("emits nothing when the cycle falls entirely outside the window", () => {
    expect(buildCardFeeEvents([feeCard()], "2026-06-01", "2026-07-01", new Date(Date.UTC(2026, 5, 1)))).toEqual([]);
  });

  it("emits nothing for a card with no renewal date", () => {
    const events = buildCardFeeEvents([feeCard({ feeMonthDay: null })], WINDOW.start, WINDOW.end, new Date(Date.UTC(2026, 2, 1)));
    expect(events).toEqual([]);
  });

  it("emits nothing for a card whose effective fee is zero", () => {
    const events = buildCardFeeEvents([feeCard({ annualFeeMinor: 0 })], WINDOW.start, WINDOW.end, new Date(Date.UTC(2026, 2, 1)));
    expect(events).toEqual([]);
  });

  it("gives the two events distinct, stable ids", () => {
    const events = buildCardFeeEvents([feeCard({ feeCancelGraceDays: 5 })], WINDOW.start, WINDOW.end, new Date(Date.UTC(2026, 2, 1)));
    expect(events.map((e) => e.id).sort()).toEqual(["cardcancel_card-1_2026-03-20", "cardfee_card-1_2026-03-15"]);
  });
});
