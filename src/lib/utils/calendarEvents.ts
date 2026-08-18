//event type + fetch helper

/**
 * THE canonical calendar event contract. This type was previously declared
 * twice — here and in src/app/api/events/route.ts — and the copies drifted:
 * this one had BILL_DUE and no TRIAL_END, the route had TRIAL_END and no
 * BILL_DUE, so the route emitted events the shared type said were impossible
 * while bills were typed for and never queried. The route now imports from
 * here. Spec: docs/superpowers/specs/2026-08-18-annual-fee-renewal-calendar-design.md §2.1.
 */
export type EventType =
  | "RENEWAL"
  | "TRIAL_END"
  | "CANCELLED_SUBSCRIPTION"
  | "RETURN_DEADLINE"
  | "REFUND_CHECK"
  | "REFUND_EXPECTED"
  | "DELIVERED"
  | "REFUNDED"
  | "BILL_DUE"
  | "CARD_FEE_POSTS"
  | "CARD_FEE_CANCEL_BY";

export type EventSourceKind = "subscription" | "return" | "bill" | "card";

export type CalendarEvent = {
  id: string;
  type: EventType;
  date: string;
  title: string;
  amountCents?: number;
  currency?: string | null;
  billStatus?: "DUE" | "PAID";
  autopay?: boolean;
  monthKey?: string;
  purchaseDate?: string;
  returnBy?: string;
  trackingNumber?: string | null;
  /** Derived rather than observed — a projected refund date, say. */
  estimated?: boolean;
  source: { kind: EventSourceKind; sourceId: string };
};


export function formatMoney(amountCents: number | undefined, currency: string | null) {
  if (amountCents == null) return "";
  const code = currency?.trim().toUpperCase();
  if (!code) return `${(amountCents / 100).toFixed(2)} (currency unknown)`;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${code} ${(amountCents / 100).toFixed(2)}`;
  }
}

export function ymKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function toISODateOnlyUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}
