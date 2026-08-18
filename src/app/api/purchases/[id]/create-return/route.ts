import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { scheduleReturnDeadlineSoon } from "@/lib/domain/notifications/eventNotificationScheduler";

export const runtime = "nodejs";

function addDaysUTC(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const purchase = await prisma.purchase.findFirst({ where: { id, userId } });
  if (!purchase) return new NextResponse("Not found", { status: 404 });

  const body = await req.json().catch(() => ({}));
  const returnWindowDays = Number(body.returnWindowDays ?? 30);
  const windowDays = Number.isFinite(returnWindowDays) ? Math.max(1, returnWindowDays) : 30;

  const purchaseDate = new Date(purchase.purchasedAt);
  const returnBy = addDaysUTC(purchaseDate, windowDays);

  const data = {
    userId,
    purchaseId: purchase.id,
    store: purchase.merchant,
    itemNote: null,
    amountCents: purchase.totalCents ?? null,
    currency: purchase.currency,
    purchaseDate,
    returnWindowDays: windowDays,
    returnBy,
    dropoffDate: null,
    refundedDate: null,
    trackingNumber: null,
    carrier: null,
    deliveredAt: null,
    refundExpectedAt: null,
    refundSlaDays: 14,
    refundType: "ORIGINAL",
    refundAmountCents: null,
  };

  const createdReturn = await prisma.returnItem.create({ data });

  await scheduleReturnDeadlineSoon({
    userId,
    returnId: createdReturn.id,
    store: createdReturn.store,
    itemNote: createdReturn.itemNote,
    returnBy: createdReturn.returnBy,
    amountCents: createdReturn.amountCents,
    currency: createdReturn.currency,
    status: createdReturn.status,
  });

  const accept = req.headers.get("accept") || "";
  if (accept.includes("application/json")) return NextResponse.json({ return: createdReturn });
  return NextResponse.redirect(new URL(`/returns`, req.url));
}
