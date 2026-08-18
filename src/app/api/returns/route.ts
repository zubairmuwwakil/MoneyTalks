//return endpoint

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { scheduleReturnDeadlineSoon, scheduleReturnDelivered } from "@/lib/domain/notifications/eventNotificationScheduler";
import { refreshShipmentTimeline, syncRefundExpectation } from "@/lib/domain/shipping/tracking";
import { canTransition, type ReturnStatus } from "@/engine/returns/transitions";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

function addDaysUTC(base: Date, days: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const {
    store,
    itemNote,
    amountCents,
    currency,
    purchaseDate,
    returnWindowDays = 30,
    returnBy,
    trackingNumber,
    carrier,
    deliveredAt,
    refundSlaDays = 14,
    refundExpectedAt,
    refundType,
  } = body;

  if (!store || typeof store !== "string") return NextResponse.json({ error: "store required" }, { status: 400 });
  if (!purchaseDate || typeof purchaseDate !== "string") return NextResponse.json({ error: "purchaseDate required" }, { status: 400 });

  const pd = new Date(purchaseDate);
  if (Number.isNaN(pd.getTime())) return NextResponse.json({ error: "purchaseDate invalid" }, { status: 400 });

  const windowDays = Number(returnWindowDays);
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    return NextResponse.json({ error: "returnWindowDays invalid" }, { status: 400 });
  }

  let rb: Date;
  if (typeof returnBy === "string" && returnBy.length > 0) {
    rb = new Date(returnBy);
    if (Number.isNaN(rb.getTime())) return NextResponse.json({ error: "returnBy invalid" }, { status: 400 });
  } else {
    rb = new Date(pd.getTime());
    rb.setUTCDate(rb.getUTCDate() + windowDays);
  }

  const tracking =
    typeof trackingNumber === "string" && trackingNumber.trim().length > 0 ? trackingNumber.trim() : null;
  const carrierVal = typeof carrier === "string" && carrier.trim().length > 0 ? carrier.trim() : null;
  const sla = Number.isFinite(Number(refundSlaDays)) ? Math.max(1, Math.floor(Number(refundSlaDays))) : 14;

  let delivered: Date | null = null;
  if (typeof deliveredAt === "string" && deliveredAt.length > 0) {
    const d = new Date(deliveredAt);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "deliveredAt invalid" }, { status: 400 });
    delivered = d;
  }

  let refundExpected: Date | null = null;
  if (typeof refundExpectedAt === "string" && refundExpectedAt.length > 0) {
    const exp = new Date(refundExpectedAt);
    if (Number.isNaN(exp.getTime())) return NextResponse.json({ error: "refundExpectedAt invalid" }, { status: 400 });
    refundExpected = exp;
  } else if (delivered) {
    refundExpected = addDaysUTC(delivered, sla);
  }

  const normalizedRefundType = (() => {
    if (typeof refundType !== "string") return "ORIGINAL";
    const upper = refundType.trim().toUpperCase();
    const allowed = new Set(["ORIGINAL", "STORE_CREDIT", "PARTIAL"]);
    return allowed.has(upper) ? upper : "ORIGINAL";
  })();

  let status: ReturnStatus = "NOT_STARTED";
  if (delivered) status = "DELIVERED";
  else if (tracking) status = "PACKED";
  if (!canTransition("NOT_STARTED", status)) {
    return NextResponse.json({ error: `Cannot initialize return at ${status}` }, { status: 400 });
  }

  const created = await prisma.returnItem.create({
    data: {
      userId,
      store,
      itemNote: itemNote ?? null,
      amountCents: typeof amountCents === "number" ? amountCents : null,
      currency: typeof currency === "string" ? normalizeCurrencyCode(currency) : null,
      purchaseDate: pd,
      returnWindowDays: windowDays,
      returnBy: rb,
      status,
      trackingNumber: tracking,
      carrier: carrierVal,
      deliveredAt: delivered,
      refundSlaDays: sla,
      refundExpectedAt: refundExpected,
      refundType: normalizedRefundType,
    },
  });

  await scheduleReturnDeadlineSoon({
    userId,
    returnId: created.id,
    store: created.store,
    itemNote: created.itemNote,
    returnBy: created.returnBy,
    amountCents: created.amountCents,
    currency: created.currency,
    status: created.status,
  });

  if (created.trackingNumber) {
    await refreshShipmentTimeline({ userId, returnId: created.id });
  }

  if (created.deliveredAt) {
    await scheduleReturnDelivered({
      userId,
      returnId: created.id,
      store: created.store,
      deliveredAt: created.deliveredAt,
    });
  }

  if (refundExpected) {
    await syncRefundExpectation({ userId, returnId: created.id, expectedAt: refundExpected, refundType: normalizedRefundType });
  }

  return NextResponse.json({ returnItem: created });
}
