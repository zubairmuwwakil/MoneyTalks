import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { ValueEventType } from "@prisma/client";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const items = await prisma.detectedItem.findMany({
    where: { userId, status: "NEW" },
    orderBy: { date: "desc" },
    take: 200,
  });

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { id, action } = body as {
    id?: string;
    action?: "KEEP" | "CANCEL" | "SNOOZE" | "DOWNGRADE" | "SWITCH_ANNUAL";
  };

  if (!id || !action) return NextResponse.json({ error: "Missing id/action" }, { status: 400 });

  const item = await prisma.detectedItem.findFirst({ where: { id, userId } });
  if (!item) return new NextResponse("Not found", { status: 404 });

  const status = action === "KEEP" ? "CONFIRMED" : "DISMISSED";

  await prisma.detectedItem.update({
    where: { id },
    data: {
      status,
    },
  });

  const currency = normalizeCurrencyCode(item.currency);
  if (action === "CANCEL" && typeof item.amountCents === "number" && currency) {
    await prisma.valueEvent.create({
      data: {
        userId,
        type: ValueEventType.AVOIDED_RENEWAL,
        amountCents: item.amountCents,
        currency,
        occurredAt: new Date(),
        sourceId: item.id,
        isEstimated: false,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    valueRecorded: action === "CANCEL" && typeof item.amountCents === "number" && currency != null,
  });
}
