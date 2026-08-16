//api endpoint for disconnections

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  await prisma.emailConnection.deleteMany({ where: { userId } });

  return NextResponse.json({ ok: true });
}
