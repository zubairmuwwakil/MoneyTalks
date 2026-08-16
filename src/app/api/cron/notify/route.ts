import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import {
  scheduleSubscriptionRenewalSoon,
  scheduleReturnDeadlineSoon,
  scheduleRefundChecks,
  scheduleRefundOverdueOnce,
} from "@/lib/domain/notifications/eventNotificationScheduler";
import { refreshShipmentTimeline } from "@/lib/domain/shipping/tracking";

export const runtime = "nodejs";

function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDaysUTC(d: Date, days: number) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const today = startOfDayUTC(new Date());
  const horizon = addDaysUTC(today, 45);
  const now = new Date();

  // Refund sweep from old cron/shipping
  const trackable = await prisma.returnItem.findMany({
    where: {
      trackingNumber: { not: null },
      deliveredAt: null,
      refundedDate: null,
      status: { in: ["NOT_STARTED", "PACKED", "DROPPED_OFF"] },
    },
    select: { id: true, userId: true },
    take: 200,
  });

  let polled = 0;
  for (const r of trackable) {
    // No plan check - everybody gets shipment tracking now
    await refreshShipmentTimeline({ userId: r.userId, returnId: r.id });
    polled++;
  }

  const [subs, returns, refundCandidates] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: "ACTIVE", renewalDate: { gte: today, lt: horizon } },
      select: { id: true, userId: true, name: true, renewalDate: true, amountCents: true, currency: true },
    }),
    prisma.returnItem.findMany({
      where: {
        status: { in: ["NOT_STARTED", "PACKED"] },
        returnBy: { gte: today, lt: horizon },
      },
      select: { id: true, userId: true, store: true, itemNote: true, amountCents: true, currency: true, returnBy: true, status: true },
    }),
    prisma.returnItem.findMany({
      where: {
        OR: [
          { dropoffDate: { not: null }, refundedDate: null },
          { refundExpectedAt: { not: null }, refundedDate: null },
        ],
      },
      select: { id: true, userId: true, store: true, dropoffDate: true, refundedDate: true, refundExpectedAt: true },
    }),
  ]);

  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: Array.from(new Set(refundCandidates.map(r => r.userId))) } },
    select: { userId: true, notifyOnRefundOverdue: true },
  });
  const prefMap = new Map(prefs.map(p => [p.userId, p.notifyOnRefundOverdue]));

  let attempted = 0;
  let overdueNotified = 0;

  for (const s of subs) {
    attempted++;
    await scheduleSubscriptionRenewalSoon({
      userId: s.userId,
      subscriptionId: s.id,
      name: s.name,
      renewalDate: s.renewalDate,
      amountCents: s.amountCents,
      currency: s.currency,
    });
  }

  for (const r of returns) {
    attempted++;
    await scheduleReturnDeadlineSoon({
      userId: r.userId,
      returnId: r.id,
      store: r.store,
      itemNote: r.itemNote,
      returnBy: r.returnBy,
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status === "NOT_STARTED" ? "NOT_STARTED" : r.status === "PACKED" ? "PACKED" : "NOT_STARTED",
    });
  }

  for (const r of refundCandidates) {
    attempted++;
    await scheduleRefundChecks({
      userId: r.userId,
      returnId: r.id,
      store: r.store,
      dropoffDate: r.dropoffDate,
      refundedDate: r.refundedDate,
    });

    if (r.refundExpectedAt) {
      if (prefMap.get(r.userId) !== false) {
        await scheduleRefundOverdueOnce({
          userId: r.userId,
          returnId: r.id,
          store: r.store,
          refundExpectedAt: r.refundExpectedAt,
          refundedDate: r.refundedDate,
        });

        if (r.refundExpectedAt < now) {
          await prisma.refundCase.upsert({
            where: { returnId: r.id },
            create: { userId: r.userId, returnId: r.id, expectedAt: r.refundExpectedAt, overdueNotifiedAt: now },
            update: { expectedAt: r.refundExpectedAt, overdueNotifiedAt: now },
          });
          overdueNotified++;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    attempted,
    polled,
    overdueNotified,
    scanned: { subs: subs.length, returns: returns.length, refundCandidates: refundCandidates.length },
  });
}
