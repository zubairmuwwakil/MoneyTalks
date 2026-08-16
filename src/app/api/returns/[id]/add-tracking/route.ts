import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { refreshShipmentTimeline, syncRefundExpectation } from "@/lib/domain/shipping/tracking";

export const runtime = "nodejs";

function addDaysUTC(base: Date, days: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const trackingRaw = typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : "";
  if (!trackingRaw) return NextResponse.json({ error: "trackingNumber required" }, { status: 400 });

  const carrier = typeof body.carrier === "string" && body.carrier.trim().length > 0 ? body.carrier.trim() : null;
  const sla = Number.isFinite(Number(body.refundSlaDays)) ? Math.max(1, Math.floor(Number(body.refundSlaDays))) : undefined;
  const deliveredAt =
    typeof body.deliveredAt === "string" && body.deliveredAt.length > 0
      ? new Date(body.deliveredAt)
      : null;
  if (deliveredAt && Number.isNaN(deliveredAt.getTime())) return NextResponse.json({ error: "deliveredAt invalid" }, { status: 400 });

  const refundTypeRaw = typeof body.refundType === "string" ? body.refundType.trim().toUpperCase() : null;
  const allowedTypes = new Set(["ORIGINAL", "STORE_CREDIT", "PARTIAL"]);
  const refundType = refundTypeRaw && allowedTypes.has(refundTypeRaw) ? refundTypeRaw : refundTypeRaw ?? null;

  let refundExpectedAt: Date | null = null;
  if (typeof body.refundExpectedAt === "string" && body.refundExpectedAt.length > 0) {
    refundExpectedAt = new Date(body.refundExpectedAt);
    if (Number.isNaN(refundExpectedAt.getTime())) return NextResponse.json({ error: "refundExpectedAt invalid" }, { status: 400 });
  } else if (deliveredAt && sla) {
    refundExpectedAt = addDaysUTC(deliveredAt, sla);
  }

  const updated = await prisma.returnItem.update({
    where: { id, userId },
    data: {
      trackingNumber: trackingRaw,
      carrier,
      refundSlaDays: sla,
      deliveredAt,
      refundExpectedAt,
      refundType,
      status: deliveredAt ? "DELIVERED" : "PACKED",
    },
  });

  const refresh = await refreshShipmentTimeline({ userId, returnId: updated.id });

  if (refundExpectedAt !== null) {
    await syncRefundExpectation({
      userId,
      returnId: updated.id,
      expectedAt: refundExpectedAt,
      refundType: refundType ?? updated.refundType ?? null,
    });
  }

  const refreshed = refresh.returnItem ?? updated;

  return NextResponse.json({
    ok: true,
    returnItem: refreshed,
    eventsAdded: refresh.eventsAdded,
  });
}
