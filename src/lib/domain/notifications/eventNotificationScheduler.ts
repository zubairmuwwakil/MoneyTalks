//one scheduler file 

import { prisma } from "@/lib/prisma";
import type { NotificationType, Prisma } from "@prisma/client";
import { formatCurrencyCodeAmount } from "@/lib/utils/currency";
import { addDaysUTC, clampDayToMonth, startOfDayUTC } from "@/lib/utils/dates";
import { computeScheduledFor, planCardFeeNotifications } from "./cardFeeNotifications";
import { currentFeeCycle, type FeeScheduleCard } from "@/lib/cards/feeSchedule";

// startOfDayUTC / addDaysUTC / clampDayToMonth now live in @/lib/utils/dates —
// they were private here, in api/events/route.ts and in cards/feeSchedule.ts.
// Duplicated helpers are how the EventType drift happened; consolidated as
// each file gets touched.
function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function upsertNotification(args: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  eventDate?: Date;
  scheduledFor: Date;
  sourceKind: string;
  sourceId: string;
  eventKey: string;
}) {
  return prisma.notification.upsert({
    where: { userId_eventKey: { userId: args.userId, eventKey: args.eventKey } },
    create: {
      userId: args.userId,
      type: args.type as NotificationType,
      title: args.title,
      body: args.body,
      eventDate: args.eventDate,
      scheduledFor: args.scheduledFor,
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
      eventKey: args.eventKey,
    },
    update: {}, // idempotent: don’t spam-update once created
  });
}

async function dismissStaleBySource(args: {
  userId: string;
  sourceKind: string;
  // exact sourceId OR prefix match (for bills monthly keys)
  sourceId?: string;
  sourceIdStartsWith?: string;
  keepEventKeys: string[];
}) {
  const where: Prisma.NotificationWhereInput = {
    userId: args.userId,
    sourceKind: args.sourceKind,
    dismissedAt: null,
    eventKey: { notIn: args.keepEventKeys },
  };
  if (args.sourceId) where.sourceId = args.sourceId;
  if (args.sourceIdStartsWith) where.sourceId = { startsWith: args.sourceIdStartsWith };

  await prisma.notification.updateMany({
    where,
    data: { dismissedAt: new Date() },
  });
}


// ---------- public APIs you call from your routes ----------
export async function scheduleSubscriptionRenewalSoon(args: {
  userId: string;
  subscriptionId: string;
  name: string;
  renewalDate: Date;
  amountCents?: number | null;
  currency?: string | null;
}) {
  const daysBefore = 3;
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: args.userId },
    select: { subLeadDays: true },
  });
  const leadDays = pref?.subLeadDays ?? daysBefore;

  const today = startOfDayUTC(new Date());
  const eventDay = startOfDayUTC(args.renewalDate);
  const scheduledFor = computeScheduledFor(today, eventDay, leadDays);

  const eventISO = isoDateOnly(eventDay);
  const amt = args.amountCents != null ? formatCurrencyCodeAmount(args.amountCents, args.currency) : "";

  const title = args.name;
  const body = `Renews on ${eventISO}${amt ? ` · ${amt}` : ""} · (${leadDays} days)`;

  const eventKey = `sub:${args.subscriptionId}:${eventISO}:lead${leadDays}`;

  await upsertNotification({
    userId: args.userId,
    type: "SUBSCRIPTION_RENEWAL_SOON",
    title,
    body,
    eventDate: eventDay,
    scheduledFor,
    sourceKind: "subscription",
    sourceId: args.subscriptionId,
    eventKey,
  });

  await dismissStaleBySource({
    userId: args.userId,
    sourceKind: "subscription",
    sourceId: args.subscriptionId,
    keepEventKeys: [eventKey],
  });
}

/** Canonical recurring-obligation scheduler. New subscription writes use this. */
export async function scheduleRecurringObligationRenewalSoon(args: {
  userId: string;
  obligationId: string;
  name: string;
  renewalDate: Date;
  amountCents?: number | null;
  currency?: string | null;
}) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: args.userId },
    select: { subLeadDays: true },
  });
  const leadDays = pref?.subLeadDays ?? 3;
  const today = startOfDayUTC(new Date());
  const eventDay = startOfDayUTC(args.renewalDate);
  const eventKey = `obligation:${args.obligationId}:${isoDateOnly(eventDay)}:lead${leadDays}`;
  await upsertNotification({
    userId: args.userId,
    type: "SUBSCRIPTION_RENEWAL_SOON",
    title: args.name,
    body: `Renews on ${isoDateOnly(eventDay)}${args.amountCents != null ? ` · ${formatCurrencyCodeAmount(args.amountCents, args.currency)}` : ""} · (${leadDays} days)`,
    eventDate: eventDay,
    scheduledFor: computeScheduledFor(today, eventDay, leadDays),
    sourceKind: "recurring-obligation",
    sourceId: args.obligationId,
    eventKey,
  });
  await dismissStaleBySource({
    userId: args.userId,
    sourceKind: "recurring-obligation",
    sourceId: args.obligationId,
    keepEventKeys: [eventKey],
  });
}

export async function scheduleReturnDeadlineSoon(args: {
  userId: string;
  returnId: string;
  store: string;
  itemNote?: string | null;
  returnBy: Date;
  amountCents?: number | null;
  currency?: string | null;
  status: "NOT_STARTED" | "PACKED" | "DROPPED_OFF" | "DELIVERED" | "REFUNDED";
}) {
  // only schedule if still actionable
  if (!(args.status === "NOT_STARTED" || args.status === "PACKED")) {
    // dismiss any previously scheduled deadline notifications
    await prisma.notification.updateMany({
      where: { userId: args.userId, sourceKind: "return", sourceId: args.returnId, type: "RETURN_DEADLINE_SOON", dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
    return;
  }

  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: args.userId },
    select: { returnLeadDays: true },
  });
  const leadDays = pref?.returnLeadDays ?? 2;

  const today = startOfDayUTC(new Date());
  const eventDay = startOfDayUTC(args.returnBy);
  const scheduledFor = computeScheduledFor(today, eventDay, leadDays);

  const eventISO = isoDateOnly(eventDay);
  const amt = args.amountCents != null ? formatCurrencyCodeAmount(args.amountCents, args.currency) : "";

  const title = `${args.store}${args.itemNote ? ` — ${args.itemNote}` : ""}`;
  const body = `Return by ${eventISO}${amt ? ` · ${amt}` : ""} · (${leadDays} days)`;

  const eventKey = `ret:${args.returnId}:${eventISO}:lead${leadDays}`;

  await upsertNotification({
    userId: args.userId,
    type: "RETURN_DEADLINE_SOON",
    title,
    body,
    eventDate: eventDay,
    scheduledFor,
    sourceKind: "return",
    sourceId: args.returnId,
    eventKey,
  });

  await dismissStaleBySource({
    userId: args.userId,
    sourceKind: "return",
    sourceId: args.returnId,
    keepEventKeys: [eventKey],
  });
}

export async function scheduleBillDueSoon(args: {
  userId: string;
  billId: string;
  name: string;
  dueDayOfMonth: number;
  amountCents?: number | null;
  currency?: string | null;
}) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: args.userId },
    select: { billLeadDays: true, windowDays: true },
  });

  const leadDays = pref?.billLeadDays ?? 2;
  const windowDays = pref?.windowDays ?? 14;

  const today = startOfDayUTC(new Date());
  const horizon = startOfDayUTC(addDaysUTC(today, windowDays));

  // generate due dates month-by-month within the window
  const keepKeys: string[] = [];
  const yStart = today.getUTCFullYear();
  const mStart = today.getUTCMonth();

  // at most 3 months covers windowDays up to ~90 comfortably
  for (let mOff = 0; mOff < 4; mOff++) {
    const y = new Date(Date.UTC(yStart, mStart + mOff, 1)).getUTCFullYear();
    const m = new Date(Date.UTC(yStart, mStart + mOff, 1)).getUTCMonth();

    const day = clampDayToMonth(y, m, args.dueDayOfMonth);
    const due = new Date(Date.UTC(y, m, day));
    const dueDay = startOfDayUTC(due);

    if (dueDay < today || dueDay > horizon) continue;

    const scheduledFor = computeScheduledFor(today, dueDay, leadDays);
    const dueISO = isoDateOnly(dueDay);

    const amt = args.amountCents != null ? formatCurrencyCodeAmount(args.amountCents, args.currency) : "amount unknown";
    const title = args.name;
    const body = `Due on ${dueISO} · ${amt} · (${leadDays} days)`;

    const monthKey = dueISO.slice(0, 7);
    const eventKey = `bill:${args.billId}:${dueISO}:lead${leadDays}`;
    keepKeys.push(eventKey);

    await upsertNotification({
      userId: args.userId,
      type: "BILL_DUE_SOON",
      title,
      body,
      eventDate: dueDay,
      scheduledFor,
      sourceKind: "bill",
      sourceId: `${args.billId}:${monthKey}`,
      eventKey,
    });
  }

  // dismiss stale month notifications for this bill that no longer fit the window
  await dismissStaleBySource({
    userId: args.userId,
    sourceKind: "bill",
    sourceIdStartsWith: `${args.billId}:`,
    keepEventKeys: keepKeys,
  });
}

// Refund-related scheduling (optional but matches your current cron behavior)
export async function scheduleRefundChecks(args: {
  userId: string;
  returnId: string;
  store: string;
  dropoffDate: Date | null;
  refundedDate: Date | null;
}) {
  if (!args.dropoffDate || args.refundedDate) return;

  const today = startOfDayUTC(new Date());
  const drop = startOfDayUTC(args.dropoffDate);

  const checks = [
    { days: 7, label: "Refund check (7d)" },
    { days: 14, label: "Refund check (14d)" },
  ];

  const keepKeys: string[] = [];

  for (const c of checks) {
    const checkDay = startOfDayUTC(addDaysUTC(drop, c.days));
    // schedule “today” if already passed but not refunded (so you still see it)
    const scheduledFor = checkDay < today ? today : checkDay;

    const eventISO = isoDateOnly(checkDay);
    const title = `${c.label}: ${args.store}`;
    const body = `Follow up on refund · ${eventISO}.`;
    const eventKey = `refund_check:${args.returnId}:${c.days}:${eventISO}`;
    keepKeys.push(eventKey);

    await upsertNotification({
      userId: args.userId,
      type: "REFUND_CHECK_DUE",
      title,
      body,
      eventDate: checkDay,
      scheduledFor,
      sourceKind: "return",
      sourceId: args.returnId,
      eventKey,
    });
  }

  await dismissStaleBySource({
    userId: args.userId,
    sourceKind: "return",
    sourceId: args.returnId,
    keepEventKeys: keepKeys,
  });
}

export async function scheduleRefundOverdueOnce(args: {
  userId: string;
  returnId: string;
  store: string;
  refundExpectedAt: Date | null;
  refundedDate: Date | null;
}) {
  if (!args.refundExpectedAt || args.refundedDate) return;

  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: args.userId },
    select: { notifyOnRefundOverdue: true },
  });
  if (pref && pref.notifyOnRefundOverdue === false) return;

  const today = startOfDayUTC(new Date());
  const expected = startOfDayUTC(args.refundExpectedAt);

  if (expected >= today) return; // not overdue yet

  const expectedISO = isoDateOnly(expected);
  const title = `Refund overdue: ${args.store}`;
  const body = `Estimated refund date: ${expectedISO}. Follow up to recover your refund.`;
  const eventKey = `refund_overdue:${args.returnId}:${expectedISO}`;

  await upsertNotification({
    userId: args.userId,
    type: "REFUND_OVERDUE",
    title,
    body,
    eventDate: expected,
    scheduledFor: today, // show in today's digest as overdue
    sourceKind: "return",
    sourceId: args.returnId,
    eventKey,
  });
}

export async function scheduleReturnDelivered(args: {
  userId: string;
  returnId: string;
  store: string;
  deliveredAt: Date;
}) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: args.userId },
    select: { notifyOnDelivery: true },
  });
  if (pref && pref.notifyOnDelivery === false) return;

  const deliveredDay = startOfDayUTC(args.deliveredAt);
  const deliveredISO = isoDateOnly(deliveredDay);
  const eventKey = `return_delivered:${args.returnId}:${deliveredISO}`;

  await upsertNotification({
    userId: args.userId,
    type: "RETURN_DELIVERED",
    title: `${args.store} delivered`,
    body: `Delivered on ${deliveredISO}`,
    eventDate: deliveredDay,
    scheduledFor: deliveredDay,
    sourceKind: "return",
    sourceId: args.returnId,
    eventKey,
  });

  await dismissStaleBySource({
    userId: args.userId,
    sourceKind: "return",
    sourceId: args.returnId,
    keepEventKeys: [eventKey],
  });
}

/**
 * The annual-fee decision reminder — the seventh scheduler, following the
 * shape of the six above. Two notifications per cycle share one
 * NotificationType and are told apart by eventKey: one ahead of the fee
 * posting, one ahead of the deadline to cancel and recover it. The second is
 * the one that matters.
 *
 * Reuses billLeadDays rather than adding a preference column; a fee decision
 * has the same "act before a dated charge" character as a bill.
 */
export async function scheduleCardFeeDecisionSoon(args: {
  userId: string;
  card: FeeScheduleCard;
  currency: string;
  today?: Date;
}) {
  const today = startOfDayUTC(args.today ?? new Date());
  const cycle = currentFeeCycle(args.card, today);

  // No renewal date, or no effective fee after waivers — nothing to decide.
  // Sweep away anything scheduled from a previous state (a date removed, a
  // waiver switched on) rather than leaving an orphaned reminder.
  if (!cycle) {
    await dismissStaleBySource({
      userId: args.userId,
      sourceKind: "card",
      sourceIdStartsWith: `${args.card.id}:`,
      keepEventKeys: [],
    });
    return;
  }

  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: args.userId },
    select: { billLeadDays: true },
  });
  const leadDays = pref?.billLeadDays ?? 2;

  const plans = planCardFeeNotifications({
    cardId: args.card.id,
    nickname: args.card.nickname,
    cycle,
    leadDays,
    today,
    currency: args.currency,
  });

  for (const plan of plans) {
    await upsertNotification({
      userId: args.userId,
      type: "CARD_FEE_DECISION_SOON",
      title: plan.title,
      body: plan.body,
      eventDate: plan.eventDate,
      scheduledFor: plan.scheduledFor,
      sourceKind: "card",
      sourceId: plan.sourceId,
      eventKey: plan.eventKey,
    });
  }

  await dismissStaleBySource({
    userId: args.userId,
    sourceKind: "card",
    sourceIdStartsWith: `${args.card.id}:`,
    keepEventKeys: plans.map((plan) => plan.eventKey),
  });
}
