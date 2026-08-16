//update return endpoint (droped off / refunded)

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { scheduleRefundChecks, scheduleRefundOverdueOnce, scheduleReturnDeadlineSoon, scheduleReturnDelivered } from "@/lib/domain/notifications/eventNotificationScheduler";
import { refreshShipmentTimeline, setRefundReceived, syncRefundExpectation } from "@/lib/domain/shipping/tracking";
import { canTransition, type ReturnStatus } from "@/engine/returns/transitions";
// avoid importing prisma enums directly; use string unions matching schema

function addDaysUTC(base: Date, days: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const current = await prisma.returnItem.findFirst({ where: { id, userId } });
  if (!current) return new NextResponse("Not found", { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const data: {
    store?: string;
    itemNote?: string | null;
    amountCents?: number | null;
    currency?: string;
    purchaseDate?: Date;
    returnWindowDays?: number;
    returnBy?: Date;
    status?: ReturnStatus;
    dropoffDate?: Date | null;
    refundedDate?: Date | null;
    trackingNumber?: string | null;
    carrier?: string | null;
    deliveredAt?: Date | null;
    refundExpectedAt?: Date | null;
    refundSlaDays?: number;
    refundType?: string | null;
  } = {};
  if (typeof body.store === "string") data.store = body.store;
  if (typeof body.itemNote === "string" || body.itemNote === null) data.itemNote = body.itemNote;
  if (typeof body.amountCents === "number" || body.amountCents === null) data.amountCents = body.amountCents;
  if (typeof body.currency === "string") data.currency = body.currency;

  if (typeof body.purchaseDate === "string") {
    const pd = new Date(body.purchaseDate);
    if (Number.isNaN(pd.getTime())) return NextResponse.json({ error: "purchaseDate invalid" }, { status: 400 });
    data.purchaseDate = pd;
  }

  if (typeof body.returnWindowDays === "number") {
    const wd = body.returnWindowDays;
    if (!Number.isFinite(wd) || wd <= 0) return NextResponse.json({ error: "returnWindowDays invalid" }, { status: 400 });
    data.returnWindowDays = wd;
  }

  // recompute returnBy if purchaseDate or returnWindowDays changes
  if (data.purchaseDate || data.returnWindowDays) {
    const pd = data.purchaseDate ?? current.purchaseDate;
    const wd = data.returnWindowDays ?? current.returnWindowDays;

    const rb = new Date(pd.getTime());
    rb.setUTCDate(rb.getUTCDate() + wd);
    data.returnBy = rb;
  }

  if (typeof body.status === "string") {
    if (!["NOT_STARTED", "PACKED", "DROPPED_OFF", "DELIVERED", "REFUNDED"].includes(body.status)) {
      return NextResponse.json({ error: "status invalid" }, { status: 400 });
    }
    data.status = body.status as ReturnStatus;
  }

  if (typeof body.dropoffDate === "string" || body.dropoffDate === null) {
    data.dropoffDate = body.dropoffDate ? new Date(body.dropoffDate) : null;
  }

  if (typeof body.refundedDate === "string" || body.refundedDate === null) {
    data.refundedDate = body.refundedDate ? new Date(body.refundedDate) : null;
  }
  if (typeof body.trackingNumber === "string" || body.trackingNumber === null) {
    const t = typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : null;
    data.trackingNumber = t && t.length > 0 ? t : null;
  }

  if (typeof body.carrier === "string" || body.carrier === null) {
    const c = typeof body.carrier === "string" ? body.carrier.trim() : null;
    data.carrier = c && c.length > 0 ? c : null;
  }

  if (typeof body.deliveredAt === "string" || body.deliveredAt === null) {
    data.deliveredAt = body.deliveredAt ? new Date(body.deliveredAt) : null;
    if (data.deliveredAt && Number.isNaN(data.deliveredAt.getTime())) {
      return NextResponse.json({ error: "deliveredAt invalid" }, { status: 400 });
    }
  }

  if (typeof body.refundExpectedAt === "string" || body.refundExpectedAt === null) {
    data.refundExpectedAt = body.refundExpectedAt ? new Date(body.refundExpectedAt) : null;
    if (data.refundExpectedAt && Number.isNaN(data.refundExpectedAt.getTime())) {
      return NextResponse.json({ error: "refundExpectedAt invalid" }, { status: 400 });
    }
  }

  if (typeof body.refundSlaDays === "number") {
    data.refundSlaDays = Math.max(1, Math.floor(body.refundSlaDays));
  }

  if (typeof body.refundType === "string" || body.refundType === null) {
    const rt = typeof body.refundType === "string" ? body.refundType.trim().toUpperCase() : null;
    const allowed = new Set(["ORIGINAL", "STORE_CREDIT", "PARTIAL"]);
    data.refundType = rt && allowed.has(rt) ? rt : rt ?? null;
  }

  if (data.deliveredAt && !data.refundExpectedAt) {
    const sla = data.refundSlaDays ?? current.refundSlaDays ?? 14;
    data.refundExpectedAt = addDaysUTC(data.deliveredAt, sla);
  }

  if (data.deliveredAt && !data.status && current.status !== "REFUNDED") {
    data.status = "DELIVERED";
  }

  if (data.status && !canTransition(current.status as ReturnStatus, data.status)) {
    return NextResponse.json(
      { error: `Cannot transition return from ${current.status} to ${data.status}. Return statuses can only move forward, and REFUNDED is terminal.` },
      { status: 409 },
    );
  }

  const updated = await prisma.returnItem.update({
    where: { id },
    data,
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

  if (updated.deliveredAt) {
    await scheduleReturnDelivered({
      userId,
      returnId: updated.id,
      store: updated.store,
      deliveredAt: updated.deliveredAt,
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

  if (updated.refundedDate) {
    await setRefundReceived({
      userId,
      returnId: updated.id,
      receivedAt: updated.refundedDate,
      refundType: updated.refundType ?? null,
    });
  }

  if (updated.trackingNumber) {
    await refreshShipmentTimeline({ userId, returnId: updated.id });
  }

  return NextResponse.json({ ok: true });
}
