import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const SCAN_MODES = new Set(["ALL", "RECEIPTS_ONLY", "SHIPPING_ONLY", "SUBSCRIPTIONS_ONLY"]);

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const connectionId = req.nextUrl.searchParams.get("connectionId");
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  const conn = await prisma.emailConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ connectionId: conn.id, scanMode: conn.scanMode });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { connectionId, scanMode } = body as { connectionId?: string; scanMode?: string };
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  if (!scanMode || !SCAN_MODES.has(scanMode)) {
    return NextResponse.json({ error: "valid scanMode required" }, { status: 400 });
  }

  const updated = await prisma.emailConnection.updateMany({
    where: { id: connectionId, userId },
    data: { scanMode: scanMode as "ALL" | "RECEIPTS_ONLY" | "SHIPPING_ONLY" | "SUBSCRIPTIONS_ONLY" },
  });
  if (updated.count === 0) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json({ connectionId, scanMode });
}
