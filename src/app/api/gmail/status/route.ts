//status + disconnect 

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const conn = await prisma.emailConnection.findUnique({ where: { userId } });

  const hasRefresh = Boolean(conn?.refreshToken);
  const hasAccess = Boolean(conn?.accessToken);
  const notExpired = conn?.expiry ? conn.expiry.getTime() > Date.now() : true;

  return NextResponse.json({
    connected: hasRefresh || (hasAccess && notExpired),
    needsReauth: !hasRefresh && (!hasAccess || !notExpired),
    emailAddress: conn?.emailAddress ?? null,
    scope: conn?.scope ?? null,
    scanMode: conn?.scanMode ?? "ALL",
    lastScanAt: conn?.lastScanAt ?? null,
  });
}
