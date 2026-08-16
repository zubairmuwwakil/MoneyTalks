import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { encryptConnectionSecrets } from "@/lib/security/emailConnectionSecrets";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const conn = await prisma.emailConnection.findUnique({
    where: { userId },
    select: { imapUser: true, imapHost: true, imapPort: true, imapSecure: true, emailAddress: true, provider: true, imapPassword: true },
  });

  return NextResponse.json({
    credentials: conn
      ? {
          emailAddress: conn.emailAddress,
          imapUser: conn.imapUser,
          imapHost: conn.imapHost,
          imapPort: conn.imapPort,
          imapSecure: conn.imapSecure,
          provider: conn.provider,
          hasPassword: Boolean(conn.imapPassword), // never the password itself, just whether one is stored
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const imapUser = typeof body.imapUser === "string" && body.imapUser.trim().length > 0 ? body.imapUser.trim() : null;
  const imapPassword = typeof body.imapPassword === "string" && body.imapPassword.trim().length > 0 ? body.imapPassword.trim() : null;
  const imapHost = typeof body.imapHost === "string" && body.imapHost.trim().length > 0 ? body.imapHost.trim() : null;
  const imapPort = Number.isFinite(Number(body.imapPort)) ? Math.max(1, Math.floor(Number(body.imapPort))) : null;
  const imapSecure = typeof body.imapSecure === "boolean" ? body.imapSecure : null;
  const emailAddress = typeof body.emailAddress === "string" && body.emailAddress.trim().length > 0 ? body.emailAddress.trim() : null;

  if (!imapUser && !imapPassword && !imapHost && !imapPort && imapSecure === null && !emailAddress) {
    return NextResponse.json({ error: "No credentials provided" }, { status: 400 });
  }

  const row = await prisma.emailConnection.upsert({
    where: { userId },
    create: {
      userId,
      provider: "GMAIL",
      emailAddress: emailAddress ?? undefined,
      imapUser: imapUser ?? undefined,
      ...encryptConnectionSecrets(userId, { imapPassword: imapPassword ?? undefined }),
      imapHost: imapHost ?? undefined,
      imapPort: imapPort ?? undefined,
      imapSecure: imapSecure ?? undefined,
    },
    update: {
      emailAddress: emailAddress ?? undefined,
      imapUser: imapUser ?? undefined,
      ...encryptConnectionSecrets(userId, { imapPassword: imapPassword ?? undefined }),
      imapHost: imapHost ?? undefined,
      imapPort: imapPort ?? undefined,
      imapSecure: imapSecure ?? undefined,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
