//status + disconnect 

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { listUserConnections } from "@/lib/services/gmailClient";
import { hasGmailReadScope } from "@/lib/services/gmailScanSource";
import type { EmailConnection } from "@prisma/client";

export const runtime = "nodejs";

export function describeConnection(conn: EmailConnection) {
  const hasRefresh = Boolean(conn.refreshToken);
  const hasAccess = Boolean(conn.accessToken);
  const notExpired = conn.expiry ? conn.expiry.getTime() > Date.now() : true;
  const hasTokens = hasRefresh || (hasAccess && notExpired);
  // A grant without the Gmail scope (user skipped the consent checkbox) can
  // authenticate but never read mail — treat it as needing reconnection.
  const gmailScopeGranted = hasGmailReadScope(conn.scope);
  const backfilledAddress = conn.emailAddress.endsWith("@invalid");

  return {
    id: conn.id,
    emailAddress: conn.emailAddress,
    connected: hasTokens && gmailScopeGranted,
    needsReauth: !hasTokens || !gmailScopeGranted || backfilledAddress,
    gmailScopeGranted,
    scope: conn.scope,
    scanMode: conn.scanMode,
    lastScanAt: conn.lastScanAt,
    lastScanError: conn.lastScanError,
  };
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const connections = await listUserConnections(userId);
  return NextResponse.json({ connections: connections.map(describeConnection) });
}
