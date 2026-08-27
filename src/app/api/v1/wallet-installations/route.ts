import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" && body.label.length > 0 ? body.label : "Untitled Installation";

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const installation = await prisma.walletInstallation.create({
    data: {
      userId,
      label,
      tokenHash,
    },
    select: {
      id: true,
      label: true,
      createdAt: true,
      revokedAt: true,
    }
  });

  return NextResponse.json({ ...installation, token: rawToken });
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const installations = await prisma.walletInstallation.findMany({
    where: { userId },
    select: { id: true, label: true, createdAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(installations);
}
