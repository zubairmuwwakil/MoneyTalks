//status + disconnect 

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { hasGmailReadScope } from "@/lib/services/gmailScanSource";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const conn = await prisma.emailConnection.findUnique({ where: { userId } });

  const hasRefresh = Boolean(conn?.refreshToken);
  const hasAccess = Boolean(conn?.accessToken);
  const notExpired = conn?.expiry ? conn.expiry.getTime() > Date.now() : true;
  const hasTokens = hasRefresh || (hasAccess && notExpired);
  // A grant without the Gmail scope (user skipped the consent checkbox) can
  // authenticate but never read mail — treat it as needing reconnection.
  const gmailScopeGranted = hasGmailReadScope(conn?.scope);

  return NextResponse.json({
    connected: hasTokens && gmailScopeGranted,
    needsReauth: Boolean(conn) && (!hasTokens || !gmailScopeGranted),
    gmailScopeGranted,
    emailAddress: conn?.emailAddress ?? null,
    scope: conn?.scope ?? null,
    scanMode: conn?.scanMode ?? "ALL",
    lastScanAt: conn?.lastScanAt ?? null,
  });
}
