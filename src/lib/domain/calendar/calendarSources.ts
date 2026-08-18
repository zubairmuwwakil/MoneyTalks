import { amountOn, occurrencesBetween, type Cadence, type ScheduleEntry } from "@/engine/recurrence";
import { currentFeeCycle, type FeeScheduleCard } from "@/lib/cards/feeSchedule";
import { toISODateOnlyUTC, type CalendarEvent } from "@/lib/utils/calendarEvents";

/**
 * The two calendar sources that /api/events was typed for but never queried.
 *
 * Pure on purpose: the route fetches, these decide. Windows are half-open
 * [start, end) to match the subscription and return logic already in the route.
 */

export interface BillSource {
  id: string;
  name: string;
  currency: string;
  autopay: boolean;
  cadence: Cadence;
  schedule: ScheduleEntry[];
}

/** Only the fields of Payment that decide an occurrence's status. */
export interface BillPaymentRow {
  billId: string;
  dueDate: Date;
  paidAt: Date | null;
}

/**
 * Bill due dates come from the CADENCE, not from Payment rows: a Payment is
 * only created when the user marks a bill paid (src/app/bills/actions.ts), so
 * nothing materialises future occurrences. Payment rows join in purely to
 * decide PAID vs DUE.
 */
export function buildBillEvents(
  bills: BillSource[],
  payments: BillPaymentRow[],
  start: string,
  end: string,
): CalendarEvent[] {
  const paidKeys = new Set(
    payments
      .filter((payment) => payment.paidAt !== null)
      .map((payment) => `${payment.billId}|${toISODateOnlyUTC(payment.dueDate)}`),
  );

  const events: CalendarEvent[] = [];
  for (const bill of bills) {
    for (const date of occurrencesBetween(bill.cadence, start, end)) {
      if (date < start || date >= end) continue;

      // A bill whose schedule has lapsed has no amount on this date. Emitting
      // it as $0 would read as "nothing owed" rather than "not scheduled".
      const amountMinor = amountOn(bill.schedule, date);
      if (amountMinor === null) continue;

      events.push({
        id: `bill_${bill.id}_${date}`,
        type: "BILL_DUE",
        date,
        title: bill.name,
        amountCents: amountMinor,
        currency: bill.currency,
        billStatus: paidKeys.has(`${bill.id}|${date}`) ? "PAID" : "DUE",
        autopay: bill.autopay,
        monthKey: date.slice(0, 7),
        source: { kind: "bill", sourceId: bill.id },
      });
    }
  }
  return events;
}

/**
 * Two events per live fee cycle — the fee landing and the deadline to recover
 * it — both derived from one stored anniversary so a month grid can show each
 * moment separately. Cards with no renewal date or no effective fee yield
 * nothing; `currentFeeCycle` already encodes that.
 */
export function buildCardFeeEvents(
  cards: FeeScheduleCard[],
  start: string,
  end: string,
  today: Date,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const card of cards) {
    const cycle = currentFeeCycle(card, today);
    if (!cycle) continue;

    const postsOn = toISODateOnlyUTC(cycle.postsOn);
    const cancelBy = toISODateOnlyUTC(cycle.cancelBy);

    if (postsOn >= start && postsOn < end) {
      events.push({
        id: `cardfee_${card.id}_${postsOn}`,
        type: "CARD_FEE_POSTS",
        date: postsOn,
        title: `${card.nickname} annual fee`,
        amountCents: cycle.feeMinor,
        source: { kind: "card", sourceId: card.id },
      });
    }

    if (cancelBy >= start && cancelBy < end) {
      events.push({
        id: `cardcancel_${card.id}_${cancelBy}`,
        type: "CARD_FEE_CANCEL_BY",
        date: cancelBy,
        title: `${card.nickname} — last day to cancel for a refund`,
        amountCents: cycle.feeMinor,
        source: { kind: "card", sourceId: card.id },
      });
    }
  }

  return events;
}
