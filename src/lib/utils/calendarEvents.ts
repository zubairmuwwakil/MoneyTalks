//event type + fetch helper

export type EventType =
  | "RENEWAL"
  | "RETURN_DEADLINE"
  | "REFUND_CHECK"
  | "REFUND_EXPECTED"
  | "DELIVERED"
  | "REFUNDED"
  | "CANCELLED_SUBSCRIPTION"
  | "BILL_DUE";

export type CalendarEvent = {
  id: string;
  type: EventType;
  date: string;
  title: string;
  amountCents?: number;
  currency?: string;
  billStatus?: "DUE" | "PAID";
  autopay?: boolean;
  monthKey?: string;
  purchaseDate?: string;
  returnBy?: string;
  trackingNumber?: string | null;
  source: { kind: "subscription" | "return" | "bill"; sourceId: string };
};


export function formatMoney(amountCents?: number, currency = "CAD") {
  if (amountCents == null) return "";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

export function ymKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function toISODateOnlyUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}
