import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { secretEquals } from "@/lib/security/secretCrypto";

export async function POST(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return new NextResponse("unauthorized", { status: 401 });
  const tokenHash = createHash("sha256").update(authorization.slice(7)).digest("hex");
  const installation = await prisma.walletInstallation.findUnique({ where: { tokenHash } });
  if (!installation || !secretEquals(installation.tokenHash, tokenHash)) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  if (!installation.revokedAt) {
    await prisma.walletInstallation.update({ where: { id: installation.id }, data: { revokedAt: new Date() } });
  }
  return NextResponse.json({ revoked: true });
}
