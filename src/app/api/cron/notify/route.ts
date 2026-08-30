import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import {
  scheduleSubscriptionRenewalSoon,
  scheduleReturnDeadlineSoon,
  scheduleRefundChecks,
  scheduleRefundOverdueOnce,
  scheduleCardFeeDecisionSoon,
} from "@/lib/domain/notifications/eventNotificationScheduler";
import { startOfDayUTC, addDaysUTC } from "@/lib/utils/dates";
import type { FeeScheduleCard } from "@/lib/cards/feeSchedule";
import type { CardDef } from "@/lib/cards/types";
import { refreshShipmentTimeline } from "@/lib/domain/shipping/tracking";
import { processWalletEvents } from "@/lib/domain/wallet/walletNormalization";
import { sendServiceFailureAlert } from "@/lib/services/alerting";
import { enqueueCronContinuation } from "@/lib/services/qstashContinuation";
import { withSpan } from "@/lib/observability";

export const runtime = "nodejs";

// Five independent streams can contribute to one invocation. Keep the total
// work comfortably below the QStash delivery timeout, then continue by cursor.
const BATCH_SIZE = 50;
export const maxDuration = 120;

type NotifyCursor = string | null | undefined;
type NotifyPayload = {
  runId?: string;
  trackableCursor?: NotifyCursor;
  subscriptionCursor?: NotifyCursor;
  returnCursor?: NotifyCursor;
  refundCursor?: NotifyCursor;
  cardCursor?: NotifyCursor;
};

function readCursor(value: unknown): NotifyCursor {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.slice(0, 100);
}

async function readPayload(req: NextRequest): Promise<NotifyPayload> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return {};
    const payload = body as Record<string, unknown>;
    return {
      runId: typeof payload.runId === "string" ? payload.runId.slice(0, 100) : undefined,
      trackableCursor: readCursor(payload.trackableCursor),
      subscriptionCursor: readCursor(payload.subscriptionCursor),
      returnCursor: readCursor(payload.returnCursor),
      refundCursor: readCursor(payload.refundCursor),
      cardCursor: readCursor(payload.cardCursor),
    };
  } catch {
    return {};
  }
}

function pageArgs(cursor: NotifyCursor): { cursor?: { id: string }; skip?: number } {
  return cursor ? { cursor: { id: cursor }, skip: 1 } : {};
}

async function runNotifyCron(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const payload = await readPayload(req);
  const runId = payload.runId ?? crypto.randomUUID();

  try {
    const walletProcessed = await processWalletEvents();

    const today = startOfDayUTC(new Date());
    const horizon = addDaysUTC(today, 45);
    const now = new Date();

    // Refund sweep from old cron/shipping
    const trackable = payload.trackableCursor === null
      ? []
      : await prisma.returnItem.findMany({
          where: {
            trackingNumber: { not: null },
            deliveredAt: null,
            refundedDate: null,
            status: { in: ["NOT_STARTED", "PACKED", "DROPPED_OFF"] },
          },
          select: { id: true, userId: true },
          orderBy: { id: "asc" },
          ...pageArgs(payload.trackableCursor),
          take: BATCH_SIZE,
        });

    let polled = 0;
    for (const r of trackable) {
      // No plan check - everybody gets shipment tracking now
      await refreshShipmentTimeline({ userId: r.userId, returnId: r.id });
      polled++;
    }

    const [subs, returns, refundCandidates, feeCards] = await withSpan(
      "cron.notify.load-batches",
      () => Promise.all([
        payload.subscriptionCursor === null
          ? Promise.resolve([])
          : prisma.subscription.findMany({
              where: { status: "ACTIVE", renewalDate: { gte: today, lt: horizon } },
              select: { id: true, userId: true, name: true, renewalDate: true, amountCents: true, currency: true },
              orderBy: { id: "asc" },
              ...pageArgs(payload.subscriptionCursor),
              take: BATCH_SIZE,
            }),
        payload.returnCursor === null
          ? Promise.resolve([])
          : prisma.returnItem.findMany({
              where: {
                status: { in: ["NOT_STARTED", "PACKED"] },
                returnBy: { gte: today, lt: horizon },
              },
              select: { id: true, userId: true, store: true, itemNote: true, amountCents: true, currency: true, returnBy: true, status: true },
              orderBy: { id: "asc" },
              ...pageArgs(payload.returnCursor),
              take: BATCH_SIZE,
            }),
        payload.refundCursor === null
          ? Promise.resolve([])
          : prisma.returnItem.findMany({
              where: {
                OR: [
                  { dropoffDate: { not: null }, refundedDate: null },
                  { refundExpectedAt: { not: null }, refundedDate: null },
                ],
              },
              select: { id: true, userId: true, store: true, dropoffDate: true, refundedDate: true, refundExpectedAt: true },
              orderBy: { id: "asc" },
              ...pageArgs(payload.refundCursor),
              take: BATCH_SIZE,
            }),
        payload.cardCursor === null
          ? Promise.resolve([])
          : prisma.creditCard.findMany({
              select: {
                id: true,
                userId: true,
                nickname: true,
                network: true,
                annualFeeMinor: true,
                feeRebateMinor: true,
                contractCardId: true,
                currency: true,
                feeMonthDay: true,
                feeCancelGraceDays: true,
              },
              orderBy: { id: "asc" },
              ...pageArgs(payload.cardCursor),
              take: BATCH_SIZE,
            }),
      ]),
      { batch_size: BATCH_SIZE },
    );

    const refundUserIds = Array.from(new Set(refundCandidates.map((r) => r.userId)));
    const prefs = refundUserIds.length === 0
      ? []
      : await prisma.notificationPreference.findMany({
          where: { userId: { in: refundUserIds } },
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

    for (const c of feeCards) {
      attempted++;
      const card: FeeScheduleCard = {
        id: c.id,
        nickname: c.nickname,
        network: c.network as CardDef["network"],
        annualFeeMinor: c.annualFeeMinor,
        feeRebateMinor: c.feeRebateMinor,
        contractCardId: c.contractCardId,
        feeMonthDay: c.feeMonthDay,
        feeCancelGraceDays: c.feeCancelGraceDays,
      };
      await scheduleCardFeeDecisionSoon({ userId: c.userId, card, currency: c.currency, today });
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

    const nextCursors = {
      trackableCursor: trackable.length === BATCH_SIZE ? trackable.at(-1)?.id ?? null : null,
      subscriptionCursor: subs.length === BATCH_SIZE ? subs.at(-1)?.id ?? null : null,
      returnCursor: returns.length === BATCH_SIZE ? returns.at(-1)?.id ?? null : null,
      refundCursor: refundCandidates.length === BATCH_SIZE ? refundCandidates.at(-1)?.id ?? null : null,
      cardCursor: feeCards.length === BATCH_SIZE ? feeCards.at(-1)?.id ?? null : null,
    };
    const hasMore = Object.values(nextCursors).some(Boolean);
    let continuation: { queued: true; messageId: string } | undefined;
    if (hasMore) {
      const next = await enqueueCronContinuation({
        path: "/api/cron/notify",
        body: { source: "qstash", job: "notify", runId, ...nextCursors },
        deduplicationId: `notify:${runId}:${JSON.stringify(nextCursors)}`,
      });
      if (!next.queued) {
        await sendServiceFailureAlert({
          serviceName: "cron/notify",
          summary: "Notification cron reached a batch limit but cannot enqueue its continuation",
          details: { runId, nextCursors },
        });
        return NextResponse.json(
          { ok: false, reason: "continuation-not-configured", attempted, polled },
          { status: 503 },
        );
      }
      continuation = next;
    }

    return NextResponse.json({
      ok: true,
      attempted,
      polled,
      overdueNotified,
      scanned: { subs: subs.length, returns: returns.length, refundCandidates: refundCandidates.length },
      walletProcessed,
      ...(continuation ? { continuation } : {}),
    });
  } catch (error) {
    await sendServiceFailureAlert({
      serviceName: "cron/notify",
      summary: "Unhandled error during notification scheduling sweep",
      error,
    });
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runNotifyCron(req);
}

export async function POST(req: NextRequest) {
  return runNotifyCron(req);
}
