import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const { id } = await params;
  const installation = await prisma.walletInstallation.findUnique({
    where: { id },
  });

  if (!installation || installation.userId !== userId) {
    return new NextResponse("not found", { status: 404 });
  }

  const updated = await prisma.walletInstallation.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: { id: true, label: true, createdAt: true, revokedAt: true }
  });

  return NextResponse.json(updated);
}
