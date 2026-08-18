import { describe, expect, it } from "vitest";
import { eventHref, eventLabel, eventTreatment } from "./eventPresentation";
import type { CalendarEvent, EventType } from "@/lib/utils/calendarEvents";

function ev(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "x_1_2026-03-15",
    type: "RENEWAL",
    date: "2026-03-15",
    title: "Netflix",
    source: { kind: "subscription", sourceId: "sub-1" },
    ...overrides,
  };
}

describe("eventTreatment", () => {
  const cases: Array<[EventType, ReturnType<typeof eventTreatment>]> = [
    ["CARD_FEE_CANCEL_BY", "destructive"],
    ["RETURN_DEADLINE", "destructive"],
    ["RENEWAL", "warning"],
    ["TRIAL_END", "warning"],
    ["CARD_FEE_POSTS", "warning"],
    ["REFUNDED", "success"],
    ["REFUND_CHECK", "info"],
    ["REFUND_EXPECTED", "info"],
    ["DELIVERED", "info"],
    ["CANCELLED_SUBSCRIPTION", "muted"],
  ];

  it.each(cases)("classifies %s as %s", (type, expected) => {
    expect(eventTreatment(ev({ type }))).toBe(expected);
  });

  it("treats an unpaid bill as warning (money is about to move)", () => {
    expect(eventTreatment(ev({ type: "BILL_DUE", billStatus: "DUE" }))).toBe("warning");
  });

  it("treats an unpaid bill with no billStatus as warning, not success", () => {
    expect(eventTreatment(ev({ type: "BILL_DUE" }))).toBe("warning");
  });

  it("treats a paid bill as success, distinct from an unpaid one", () => {
    expect(eventTreatment(ev({ type: "BILL_DUE", billStatus: "PAID" }))).toBe("success");
  });
});

describe("eventLabel", () => {
  it("distinguishes a paid bill from a due one", () => {
    expect(eventLabel(ev({ type: "BILL_DUE", billStatus: "DUE" }))).toBe("Bill due");
    expect(eventLabel(ev({ type: "BILL_DUE", billStatus: "PAID" }))).toBe("Bill paid");
  });

  it("phrases the card-fee cancel deadline as a decision, not an announcement", () => {
    expect(eventLabel(ev({ type: "CARD_FEE_CANCEL_BY" }))).toBe("Cancel-by deadline");
  });

  it("labels every event type with non-empty text", () => {
    const types: EventType[] = [
      "RENEWAL",
      "TRIAL_END",
      "CANCELLED_SUBSCRIPTION",
      "RETURN_DEADLINE",
      "REFUND_CHECK",
      "REFUND_EXPECTED",
      "DELIVERED",
      "REFUNDED",
      "BILL_DUE",
      "CARD_FEE_POSTS",
      "CARD_FEE_CANCEL_BY",
    ];
    for (const type of types) {
      expect(eventLabel(ev({ type })).length).toBeGreaterThan(0);
    }
  });
});

describe("eventHref", () => {
  it("links a card event to its card detail page", () => {
    expect(eventHref(ev({ source: { kind: "card", sourceId: "card-9" } }))).toBe("/cards/card-9");
  });

  it("links a bill event to its bill detail page", () => {
    expect(eventHref(ev({ source: { kind: "bill", sourceId: "bill-9" } }))).toBe("/bills/bill-9");
  });

  it("links a return event to its return detail page", () => {
    expect(eventHref(ev({ source: { kind: "return", sourceId: "ret-9" } }))).toBe("/returns/ret-9");
  });

  it("links a subscription event to the subscriptions list (no per-item detail page)", () => {
    expect(eventHref(ev({ source: { kind: "subscription", sourceId: "sub-9" } }))).toBe("/subscriptions");
  });
});
