import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const purchase = await prisma.purchase.findFirst({
    where: { id, userId },
    include: { items: true, attachments: true, returns: true },
  });

  if (!purchase) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json({ purchase });
}
