import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

const MONTHS_TARGET = 24;

function utcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function targetStart(today: Date): Date {
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - MONTHS_TARGET, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(today.getUTCDate(), lastDay));
  return first;
}

function monthsCovered(cursor: string | null, complete: boolean, now: Date): number {
  if (complete) return MONTHS_TARGET;
  if (!cursor || !/^\d{4}-\d{2}-\d{2}$/.test(cursor)) return 0;
  const cursorDate = new Date(`${cursor}T00:00:00.000Z`);
  if (!Number.isFinite(cursorDate.getTime()) || cursorDate.toISOString().slice(0, 10) !== cursor) return 0;

  const today = utcDate(now);
  const start = targetStart(today);
  const targetMs = today.getTime() - start.getTime();
  const coveredMs = today.getTime() - cursorDate.getTime();
  if (targetMs <= 0 || coveredMs <= 0) return 0;
  return Math.min(MONTHS_TARGET, Math.round((coveredMs / targetMs) * MONTHS_TARGET));
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const connections = await prisma.emailConnection.findMany({
    where: { userId, provider: "GMAIL" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      emailAddress: true,
      backfillRequestedAt: true,
      backfillCursor: true,
      backfillCompletedAt: true,
    },
  });
  const now = new Date();

  return NextResponse.json({
    connections: connections.map((connection) => ({
      connectionId: connection.id,
      emailAddress: connection.emailAddress,
      requestedAt: connection.backfillRequestedAt,
      cursor: connection.backfillCursor,
      completedAt: connection.backfillCompletedAt,
      monthsCovered: monthsCovered(
        connection.backfillCursor,
        Boolean(connection.backfillCompletedAt),
        now,
      ),
      monthsTarget: MONTHS_TARGET,
      complete: Boolean(connection.backfillCompletedAt),
    })),
  });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const connectionId = body && typeof body.connectionId === "string" ? body.connectionId : null;
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  }

  const requestedAt = new Date();
  const updated = await prisma.emailConnection.updateMany({
    where: { id: connectionId, userId },
    data: { backfillRequestedAt: requestedAt },
  });
  if (updated.count === 0) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json({
    ok: true,
    connectionId,
    requestedAt: requestedAt.toISOString(),
  });
}
