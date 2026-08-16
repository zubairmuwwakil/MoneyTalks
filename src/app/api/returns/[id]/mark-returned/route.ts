//endpoint for mark returned  mark refunded

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { scheduleRefundChecks, scheduleRefundOverdueOnce, scheduleReturnDeadlineSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { refreshShipmentTimeline, syncRefundExpectation } from "@/lib/domain/shipping/tracking";
import { canTransition } from "@/engine/returns/transitions";

export const runtime = "nodejs";

function addDaysUTC(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const trackingNumber =
    typeof body?.trackingNumber === "string" && body.trackingNumber.trim().length > 0
      ? body.trackingNumber.trim()
      : null;

  const item = await prisma.returnItem.findFirst({ where: { id, userId } });
  if (!item) return new NextResponse("Not found", { status: 404 });
  if (!canTransition(item.status, "DROPPED_OFF")) {
    return NextResponse.json(
      { error: `Cannot transition return from ${item.status} to DROPPED_OFF. Return statuses can only move forward, and REFUNDED is terminal.` },
      { status: 409 },
    );
  }

  const now = new Date();

  const dropoff = item.dropoffDate ?? now;
  const sla = item.refundSlaDays ?? 14;
  const expected = item.refundExpectedAt ?? addDaysUTC(dropoff, sla); // default: refund SLA

  const updated = await prisma.returnItem.update({
    where: { id },
    data: {
      status: "DROPPED_OFF",
      dropoffDate: dropoff,
      refundExpectedAt: expected,
      trackingNumber,
    },
  });

  await scheduleReturnDeadlineSoon({
    userId,
    returnId: updated.id,
    store: updated.store,
    itemNote: updated.itemNote,
    returnBy: updated.returnBy,
    amountCents: updated.amountCents,
    currency: updated.currency,
    status: updated.status,
  });

  await scheduleRefundChecks({
    userId,
    returnId: updated.id,
    store: updated.store,
    dropoffDate: updated.dropoffDate,
    refundedDate: updated.refundedDate,
  });

  if (updated.refundExpectedAt) {
    await scheduleRefundOverdueOnce({
      userId,
      returnId: updated.id,
      store: updated.store,
      refundExpectedAt: updated.refundExpectedAt ?? null,
      refundedDate: updated.refundedDate,
    });
  }

  if (updated.refundExpectedAt !== null) {
    await syncRefundExpectation({
      userId,
      returnId: updated.id,
      expectedAt: updated.refundExpectedAt,
      refundType: updated.refundType ?? null,
    });
  }

  if (updated.trackingNumber) {
    await refreshShipmentTimeline({ userId, returnId: updated.id });
  }

  return NextResponse.json({ ok: true, returnItem: updated });
}
