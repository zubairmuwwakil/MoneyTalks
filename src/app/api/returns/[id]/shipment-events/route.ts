import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const ret = await prisma.returnItem.findFirst({ where: { id, userId }, select: { id: true } });
  if (!ret) return new NextResponse("Not found", { status: 404 });

  const events = await prisma.shipmentEvent.findMany({
    where: { returnId: id, userId },
    orderBy: { occurredAt: "asc" },
  });

  return NextResponse.json({ events, estimated: true });
}
