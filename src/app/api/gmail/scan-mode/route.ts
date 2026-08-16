import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const conn = await prisma.emailConnection.findUnique({ where: { userId } });
  return NextResponse.json({ scanMode: conn?.scanMode ?? "ALL" });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { scanMode } = body as { scanMode?: "ALL" | "RECEIPTS_ONLY" | "SHIPPING_ONLY" | "SUBSCRIPTIONS_ONLY" };
  if (!scanMode) return NextResponse.json({ error: "scanMode required" }, { status: 400 });

  const updated = await prisma.emailConnection.upsert({
    where: { userId },
    create: { userId, provider: "GMAIL", scanMode },
    update: { scanMode },
  });

  return NextResponse.json({ scanMode: updated.scanMode });
}
