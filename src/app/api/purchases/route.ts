import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const merchant = url.searchParams.get("merchant");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: Record<string, unknown> = { userId };

  if (merchant) {
    where.merchant = { contains: merchant, mode: "insensitive" };
  }

  if (from || to) {
    where.purchasedAt = {
      gte: from ? new Date(from + "T00:00:00.000Z") : undefined,
      lte: to ? new Date(to + "T23:59:59.999Z") : undefined,
    };
  }

  const purchases = await prisma.purchase.findMany({
    where,
    include: { returns: true },
    orderBy: { purchasedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ purchases });
}
