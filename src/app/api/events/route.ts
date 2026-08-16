import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { parseISODateParam } from "@/lib/utils/dateParams";

type EventType =
  | "RENEWAL"
  | "TRIAL_END"
  | "CANCELLED_SUBSCRIPTION"
  | "RETURN_DEADLINE"
  | "REFUND_CHECK"
  | "REFUND_EXPECTED"
  | "REFUNDED"
  | "DELIVERED";

export interface CalendarEvent {
  id: string;
  type: EventType;
  date: string;
  title: string;
  amountCents?: number;
  currency: string;
  source: {
    kind: "subscription" | "return";
    sourceId: string;
  };
  purchaseDate?: string;
  returnBy?: string;
  trackingNumber?: string | null;
  estimated?: boolean;
}

export const runtime = "nodejs";

function addDaysUTC(d: Date, days: number) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function toISODateOnlyUTC(d: Date) {
  return d.toISOString().split("T")[0];
}

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

  const [activeSubs, cancelledSubs, returnItems, snoozedEvents] = await Promise.all([
    prisma.subscription.findMany({
      where: {
        userId,
        OR: [
          { renewalDate: { gte: start, lt: end } },
          { trialEndAt: { gte: start, lt: end } },
        ],
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        amountCents: true,
        currency: true,
        renewalDate: true,
        trialEndAt: true,
      },
      orderBy: { renewalDate: "asc" },
    }),
    prisma.subscription.findMany({
      where: {
        userId,
        status: "CANCELLED",
        updatedAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        name: true,
        amountCents: true,
        currency: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
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
  ]);

  const events: CalendarEvent[] = [];

  for (const s of activeSubs) {
    events.push({
      id: `sub_${s.id}_${toISODateOnlyUTC(s.renewalDate)}`,
      type: "RENEWAL",
      date: toISODateOnlyUTC(s.renewalDate),
      title: s.name,
      amountCents: s.amountCents ?? undefined,
      currency: s.currency,
      source: { kind: "subscription", sourceId: s.id },
    });

    if (s.trialEndAt && s.trialEndAt >= start && s.trialEndAt < end) {
      events.push({
        id: `trial_${s.id}_${toISODateOnlyUTC(s.trialEndAt)}`,
        type: "TRIAL_END",
        date: toISODateOnlyUTC(s.trialEndAt),
        title: `${s.name} trial ends`,
        amountCents: s.amountCents ?? undefined,
        currency: s.currency,
        source: { kind: "subscription", sourceId: s.id },
      });
    }
  }

  for (const c of cancelledSubs) {
    events.push({
      id: `subcancel_${c.id}_${toISODateOnlyUTC(c.updatedAt)}`,
      type: "CANCELLED_SUBSCRIPTION",
      date: toISODateOnlyUTC(c.updatedAt),
      title: `${c.name} cancelled`,
      amountCents: c.amountCents ?? undefined,
      currency: c.currency,
      source: { kind: "subscription", sourceId: c.id },
    });
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

  const snoozedMap = new Map(snoozedEvents.map(s => [s.eventId, s.snoozedUntil]));
  const activeEvents = events.filter(ev => {
    const until = snoozedMap.get(ev.id);
    return !until || until <= now;
  });

  activeEvents.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type.localeCompare(b.type)));

  return NextResponse.json({ events: activeEvents });
}
