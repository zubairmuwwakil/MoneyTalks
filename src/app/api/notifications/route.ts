//api list + mark read/dismiss

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

  const where: { userId: string; dismissedAt: null; readAt?: null } = { userId, dismissedAt: null };
  if (unreadOnly) where.readAt = null;

  const [unreadCount, notifications] = await Promise.all([
    prisma.notification.count({ where: { userId, dismissedAt: null, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
      take: limit,
    }),
  ]);

  return NextResponse.json({ unreadCount, notifications });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const action = String(body.action ?? "");
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!action || ids.length === 0) {
    return NextResponse.json({ error: "Provide action and ids[]" }, { status: 400 });
  }

  if (action === "READ") {
    await prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { readAt: new Date() },
    });
  } else if (action === "UNREAD") {
    await prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { readAt: null },
    });
  } else if (action === "DISMISS") {
    await prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { dismissedAt: new Date() },
    });
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
