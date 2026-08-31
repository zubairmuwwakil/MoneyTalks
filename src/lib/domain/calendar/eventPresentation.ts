import type { CalendarEvent, EventSourceKind, EventType } from "@/lib/utils/calendarEvents";

/**
 * How an event should read on the calendar UI, derived purely from its
 * type (and, for bills, its status) — kept out of the client component so
 * the classification itself is unit-tested rather than eyeballed in a
 * browser. The return values are exactly the Badge component's variant
 * names (src/components/ui/badge.tsx) so callers can pass them straight
 * through without a second lookup table.
 */
export type EventTreatment = "destructive" | "warning" | "success" | "info" | "muted";

const TREATMENT: Record<EventType, EventTreatment> = {
  // Act-or-lose-money deadlines.
  CARD_FEE_CANCEL_BY: "destructive",
  RETURN_DEADLINE: "destructive",
  // Money is about to move; nothing has gone wrong yet.
  RENEWAL: "warning",
  TRIAL_END: "warning",
  CARD_FEE_POSTS: "warning",
  BILL_DUE: "warning",
  // Resolved positively.
  REFUNDED: "success",
  // Informational / not yet final.
  REFUND_CHECK: "info",
  REFUND_EXPECTED: "info",
  DELIVERED: "info",
  // No longer relevant.
  CANCELLED_SUBSCRIPTION: "muted",
};

export function eventTreatment(ev: CalendarEvent): EventTreatment {
  if (ev.type === "BILL_DUE" && ev.billStatus === "PAID") return "success";
  return TREATMENT[ev.type];
}

const LABEL: Record<EventType, string> = {
  RENEWAL: "Renews",
  TRIAL_END: "Trial ends",
  CANCELLED_SUBSCRIPTION: "Cancelled",
  RETURN_DEADLINE: "Return by",
  REFUND_CHECK: "Refund check",
  REFUND_EXPECTED: "Refund expected",
  DELIVERED: "Delivered",
  REFUNDED: "Refunded",
  BILL_DUE: "Bill due",
  CARD_FEE_POSTS: "Annual fee posts",
  CARD_FEE_CANCEL_BY: "Cancel-by deadline",
};

export function eventLabel(ev: CalendarEvent): string {
  if (ev.type === "BILL_DUE") return ev.billStatus === "PAID" ? "Bill paid" : "Bill due";
  return LABEL[ev.type];
}

const HREF_BY_KIND: Record<EventSourceKind, (sourceId: string) => string> = {
  card: (id) => `/cards/${id}`,
  bill: (id) => `/bills/${id}`,
  return: (id) => `/returns/${id}`,
  // Subscriptions have no per-item detail page — the board itself is it.
  subscription: () => "/subscriptions",
  "recurring-obligation": () => "/subscriptions",
};

export function eventHref(ev: CalendarEvent): string {
  return HREF_BY_KIND[ev.source.kind](ev.source.sourceId);
}
