import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

type SnoozePayload = {
  id?: string;
  type?: string;
  date?: string;
  delayDays?: number;
  source?: unknown;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Persist snoozed events per user so they stay hidden across sessions.
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as SnoozePayload | null;
  if (!body?.id || !body?.type || !body?.date) {
    return NextResponse.json({ error: "id, type, and date are required" }, { status: 400 });
  }

  const delayDaysRaw = Number(body.delayDays ?? 3);
  const delayDays = Number.isFinite(delayDaysRaw) ? clamp(Math.round(delayDaysRaw), 1, 30) : 3;

  const snoozedUntil = new Date();
  snoozedUntil.setUTCDate(snoozedUntil.getUTCDate() + delayDays);

  await prisma.snoozedEvent.upsert({
    where: { userId_eventId: { userId, eventId: body.id } },
    create: { userId, eventId: body.id, snoozedUntil },
    update: { snoozedUntil },
  });

  return NextResponse.json({ status: "ok", snoozedUntil: snoozedUntil.toISOString() });
}
