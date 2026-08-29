//api endpoint for disconnections

import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const connectionId = body && typeof body.connectionId === "string" ? body.connectionId : null;
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });

  const deleted = await prisma.emailConnection.deleteMany({ where: { id: connectionId, userId } });
  if (deleted.count === 0) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json({ ok: true });
}
