import type { FeeCycle } from "@/lib/cards/feeSchedule";
import { formatCurrencyCodeAmount } from "@/lib/utils/currency";
import { addDaysUTC, startOfDayUTC, toISODateOnlyUTC } from "@/lib/utils/dates";

/**
 * Decides WHICH annual-fee notifications should exist; the scheduler writes
 * them. Kept free of Prisma so the timing rules are testable directly.
 */

export type CardFeePhase = "posts" | "cancel";

export interface CardFeeNotificationPlan {
  phase: CardFeePhase;
  eventKey: string;
  title: string;
  body: string;
  /** The day the thing being announced actually happens. */
  eventDate: Date;
  /** The day the user should be told. Never in the past. */
  scheduledFor: Date;
  sourceId: string;
}

/**
 * Shared with eventNotificationScheduler — a notification is due `leadDays`
 * before its event, except that a late-added or late-edited record notifies
 * today rather than silently missing a window that has already passed.
 */
export function computeScheduledFor(todayUTC: Date, eventDayUTC: Date, leadDays: number) {
  const notifyDay = startOfDayUTC(addDaysUTC(eventDayUTC, -leadDays));
  return notifyDay < todayUTC ? todayUTC : notifyDay;
}

export function planCardFeeNotifications(args: {
  cardId: string;
  nickname: string;
  cycle: FeeCycle;
  leadDays: number;
  today: Date;
  currency: string;
}): CardFeeNotificationPlan[] {
  const { cardId, nickname, cycle, leadDays, currency } = args;
  const today = startOfDayUTC(args.today);
  const amount = formatCurrencyCodeAmount(cycle.feeMinor, currency);

  const postsISO = toISODateOnlyUTC(cycle.postsOn);
  const cancelISO = toISODateOnlyUTC(cycle.cancelBy);

  const plans: CardFeeNotificationPlan[] = [];

  // Only warn about the fee landing while it is still ahead. Inside the
  // decision window the anniversary is already behind us, and computeScheduledFor
  // would clamp a past date to today — firing "your fee is about to post" on a
  // fee that posted last week.
  if (cycle.phase === "UPCOMING") {
    plans.push({
      phase: "posts",
      eventKey: `cardfee:${cardId}:posts:${postsISO}:lead${leadDays}`,
      title: `${nickname} annual fee`,
      body: `${amount} posts on ${postsISO} · cancel by ${cancelISO} to recover it · (${leadDays} days)`,
      eventDate: cycle.postsOn,
      scheduledFor: computeScheduledFor(today, startOfDayUTC(cycle.postsOn), leadDays),
      sourceId: `${cardId}:posts`,
    });
  }

  plans.push({
    phase: "cancel",
    eventKey: `cardfee:${cardId}:cancel:${cancelISO}:lead${leadDays}`,
    title: `${nickname} — decide by ${cancelISO}`,
    body: `Cancel by ${cancelISO} to recover the ${amount} annual fee · (${leadDays} days)`,
    eventDate: cycle.cancelBy,
    scheduledFor: computeScheduledFor(today, startOfDayUTC(cycle.cancelBy), leadDays),
    sourceId: `${cardId}:cancel`,
  });

  return plans;
}
