import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { secretEquals } from "@/lib/security/secretCrypto";

export async function POST(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ verified: false }, { status: 401 });
  }
  const tokenHash = createHash("sha256").update(authorization.slice(7)).digest("hex");
  const installation = await prisma.walletInstallation.findUnique({ where: { tokenHash } });
  if (!installation || installation.revokedAt || !secretEquals(installation.tokenHash, tokenHash)) {
    return NextResponse.json({ verified: false }, { status: 401 });
  }
  return NextResponse.json({ verified: true, installationId: installation.id });
}
