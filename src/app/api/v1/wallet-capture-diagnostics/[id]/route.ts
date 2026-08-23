import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const result = await prisma.walletCaptureDiagnostic.deleteMany({ where: { id, userId } });
  if (result.count === 0) return new NextResponse("not found", { status: 404 });
  return NextResponse.json({ deleted: true });
}
