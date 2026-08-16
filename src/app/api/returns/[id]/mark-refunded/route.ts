import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { scheduleRefundChecks, scheduleRefundOverdueOnce, scheduleReturnDeadlineSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { setRefundReceived } from "@/lib/domain/shipping/tracking";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const refundAmountCents =
    typeof body?.refundAmountCents === "number" ? Math.max(0, Math.floor(body.refundAmountCents)) : undefined;

  const item = await prisma.returnItem.findFirst({ where: { id, userId } });
  if (!item) return new NextResponse("Not found", { status: 404 });

  const updated = await prisma.returnItem.update({
    where: { id },
    data: {
      status: "REFUNDED",
      refundedDate: item.refundedDate ?? new Date(),
      refundAmountCents: refundAmountCents ?? item.refundAmountCents ?? null,
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

  if (updated.refundedDate) {
    await setRefundReceived({
      userId,
      returnId: updated.id,
      receivedAt: updated.refundedDate,
      refundType: updated.refundType ?? null,
    });
  }

  return NextResponse.json({ ok: true, returnItem: updated });
}
