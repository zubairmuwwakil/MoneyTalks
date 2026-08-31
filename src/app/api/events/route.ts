import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { parseISODateParam } from "@/lib/utils/dateParams";
import { addDaysUTC, toISODateOnlyUTC } from "@/lib/utils/dates";
import type { CalendarEvent } from "@/lib/utils/calendarEvents";
import { buildBillEvents, buildCardFeeEvents, type BillSource } from "@/lib/domain/calendar/calendarSources";
import type { CardDef } from "@/lib/cards/types";
import type { FeeScheduleCard } from "@/lib/cards/feeSchedule";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { currentAmountMinor, isRenewalRelevant, obligationName } from "@/lib/domain/recurring/readModel";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const start = parseISODateParam(url.searchParams.get("start"));
  const end = parseISODateParam(url.searchParams.get("end"));
  const now = new Date();

  if (!start || !end) {
    return NextResponse.json(
      { error: "Provide start and end as YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const [subscriptions, returnItems, snoozedEvents, bills, billPayments, cards] = await Promise.all([
    prisma.recurringObligation.findMany({
      where: {
        userId,
        kind: "SUBSCRIPTION",
        OR: [
          { nextExpectedDate: { gte: start, lt: end } },
          {
            ownerFacts: {
              some: {
                supersededBy: null,
                type: { in: ["TRIAL_ENDED", "CANCELLATION"] },
                OR: [
                  { effectiveAt: { gte: start, lt: end } },
                  { effectiveAt: null, occurredAt: { gte: start, lt: end } },
                ],
              },
            },
          },
        ],
      },
      select: {
        id: true, displayName: true, merchantCanonicalId: true, schedule: true,
        currency: true, nextExpectedDate: true, status: true,
        ownerFacts: {
          where: { supersededBy: null, type: { in: ["TRIAL_ENDED", "CANCELLATION"] } },
          select: { id: true, type: true, occurredAt: true, effectiveAt: true },
        },
      },
      orderBy: { nextExpectedDate: "asc" },
    }),
    prisma.returnItem.findMany({
      where: {
        userId,
        OR: [
          { returnBy: { gte: start, lt: end } },
          // include dropoffs slightly before range to compute refund checks within range
          { dropoffDate: { gte: addDaysUTC(start, -20), lt: end } },
        ],
      },
      select: {
        id: true,
        store: true,
        itemNote: true,
        amountCents: true,
        currency: true,
        purchaseDate: true,
        returnBy: true,
        status: true,
        dropoffDate: true,
        refundExpectedAt: true,
        deliveredAt: true,
        refundedDate: true,
        refundAmountCents: true,
        trackingNumber: true,
        refundSlaDays: true,
        carrier: true,
      },
      orderBy: { returnBy: "asc" },
    }),
    prisma.snoozedEvent.findMany({
      where: { userId, snoozedUntil: { gt: now } },
      select: { eventId: true, snoozedUntil: true },
    }),
    prisma.bill.findMany({
      where: { userId },
      select: { id: true, name: true, currency: true, autopay: true, cadence: true, schedule: true },
    }),
    // Payment rows exist only for occurrences the user has marked paid, so
    // this is a status lookup, not the source of due dates.
    prisma.payment.findMany({
      where: { bill: { userId }, dueDate: { gte: start, lt: end } },
      select: { billId: true, dueDate: true, paidAt: true },
    }),
    prisma.creditCard.findMany({
      where: { userId },
      select: {
        id: true,
        nickname: true,
        network: true,
        annualFeeMinor: true,
        feeRebateMinor: true,
        contractCardId: true,
        feeMonthDay: true,
        feeCancelGraceDays: true,
      },
    }),
  ]);

  const events: CalendarEvent[] = [];

  for (const subscription of subscriptions) {
    const name = obligationName(subscription);
    const amountCents = currentAmountMinor(subscription.schedule);
    if (subscription.nextExpectedDate && isRenewalRelevant(subscription.status)
      && subscription.nextExpectedDate >= start && subscription.nextExpectedDate < end) {
      events.push({
        id: `obligation_${subscription.id}_${toISODateOnlyUTC(subscription.nextExpectedDate)}`,
        type: "RENEWAL",
        date: toISODateOnlyUTC(subscription.nextExpectedDate),
        title: name,
        amountCents: amountCents ?? undefined,
        currency: subscription.currency,
        source: { kind: "recurring-obligation", sourceId: subscription.id },
      });
    }
    for (const fact of subscription.ownerFacts) {
      const eventDate = fact.effectiveAt ?? fact.occurredAt;
      if (eventDate < start || eventDate >= end) continue;
      const trial = fact.type === "TRIAL_ENDED";
      events.push({
        id: `${trial ? "trial" : "obligation_cancel"}_${fact.id}_${toISODateOnlyUTC(eventDate)}`,
        type: trial ? "TRIAL_END" : "CANCELLED_SUBSCRIPTION",
        date: toISODateOnlyUTC(eventDate),
        title: trial ? `${name} trial ends` : `${name} cancellation takes effect`,
        amountCents: amountCents ?? undefined,
        currency: subscription.currency,
        source: { kind: "recurring-obligation", sourceId: subscription.id },
      });
    }
  }

  for (const r of returnItems) {
    const expectedRefundAt =
      r.refundExpectedAt ??
      (r.deliveredAt
        ? addDaysUTC(r.deliveredAt, r.refundSlaDays ?? 14)
        : r.dropoffDate
        ? addDaysUTC(r.dropoffDate, r.refundSlaDays ?? 14)
        : null);

    const deadlineDate = toISODateOnlyUTC(r.returnBy);
    if (r.returnBy >= start && r.returnBy < end && r.status !== "REFUNDED" && r.status !== "DELIVERED") {
      events.push({
        id: `ret_${r.id}_${deadlineDate}`,
        type: "RETURN_DEADLINE",
        date: deadlineDate,
        title: `${r.store}${r.itemNote ? ` — ${r.itemNote}` : ""}`,
        amountCents: r.amountCents ?? undefined,
        currency: r.currency,
        source: { kind: "return", sourceId: r.id },
        purchaseDate: toISODateOnlyUTC(r.purchaseDate),
        returnBy: deadlineDate,
        trackingNumber: r.trackingNumber ?? null,
      });
    }

    if (r.dropoffDate && !r.refundedDate && r.status !== "REFUNDED") {
      const check7 = addDaysUTC(r.dropoffDate, 7);
      const checkSla = expectedRefundAt ?? addDaysUTC(r.dropoffDate, 14);

      for (const [checkDate, label] of [
        [check7, "Refund check (7d)"],
        [checkSla, "Estimated refund expected"],
      ] as const) {
        if (checkDate >= start && checkDate < end) {
          events.push({
            id: `ref_${r.id}_${label}_${toISODateOnlyUTC(checkDate)}`,
            type: label === "Estimated refund expected" ? "REFUND_EXPECTED" : "REFUND_CHECK",
            date: toISODateOnlyUTC(checkDate),
            title: `${label}: ${r.store}`,
            amountCents: r.amountCents ?? undefined,
            currency: r.currency,
            source: { kind: "return", sourceId: r.id },
            purchaseDate: toISODateOnlyUTC(r.purchaseDate),
            returnBy: toISODateOnlyUTC(r.returnBy),
            trackingNumber: r.trackingNumber ?? null,
            estimated: true,
          });
        }
      }
    }

    if (r.refundedDate && r.refundedDate >= start && r.refundedDate < end) {
      events.push({
        id: `refunded_${r.id}_${toISODateOnlyUTC(r.refundedDate)}`,
        type: "REFUNDED",
        date: toISODateOnlyUTC(r.refundedDate),
        title: `${r.store} — Refunded`,
        amountCents: r.refundAmountCents ?? r.amountCents ?? undefined,
        currency: r.currency,
        source: { kind: "return", sourceId: r.id },
        purchaseDate: toISODateOnlyUTC(r.purchaseDate),
        returnBy: toISODateOnlyUTC(r.returnBy),
        trackingNumber: r.trackingNumber ?? null,
      });
    }

    if (r.deliveredAt && r.deliveredAt >= start && r.deliveredAt < end) {
      events.push({
        id: `delivered_${r.id}_${toISODateOnlyUTC(r.deliveredAt)}`,
        type: "DELIVERED",
        date: toISODateOnlyUTC(r.deliveredAt),
        title: `${r.store} — Delivered`,
        amountCents: r.amountCents ?? undefined,
        currency: r.currency,
        source: { kind: "return", sourceId: r.id },
        purchaseDate: toISODateOnlyUTC(r.purchaseDate),
        returnBy: toISODateOnlyUTC(r.returnBy),
        trackingNumber: r.trackingNumber ?? null,
      });
    }
  }

  const billSources: BillSource[] = bills.map(b => ({
    id: b.id,
    name: b.name,
    currency: b.currency,
    autopay: b.autopay,
    cadence: b.cadence as unknown as Cadence,
    schedule: b.schedule as unknown as ScheduleEntry[],
  }));
  const feeCards: FeeScheduleCard[] = cards.map(c => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    feeRebateMinor: c.feeRebateMinor,
    contractCardId: c.contractCardId,
    feeMonthDay: c.feeMonthDay,
    feeCancelGraceDays: c.feeCancelGraceDays,
  }));

  const startISO = toISODateOnlyUTC(start);
  const endISO = toISODateOnlyUTC(end);
  events.push(...buildBillEvents(billSources, billPayments, startISO, endISO));
  events.push(...buildCardFeeEvents(feeCards, startISO, endISO, now));

  const snoozedMap = new Map(snoozedEvents.map(s => [s.eventId, s.snoozedUntil]));
  const activeEvents = events.filter(ev => {
    const until = snoozedMap.get(ev.id);
    return !until || until <= now;
  });

  activeEvents.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type.localeCompare(b.type)));

  return NextResponse.json({ events: activeEvents });
}
