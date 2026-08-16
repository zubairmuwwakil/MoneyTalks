import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: subscriptionId } = await params;
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { detectedItemId } = body as { detectedItemId?: string };
  if (!detectedItemId) return NextResponse.json({ error: "detectedItemId required" }, { status: 400 });

  const sub = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
  if (!sub) return new NextResponse("Not found", { status: 404 });

  const item = await prisma.detectedItem.findFirst({ where: { id: detectedItemId, userId } });
  if (!item) return new NextResponse("Not found", { status: 404 });

  await prisma.detectedItem.update({
    where: { id: detectedItemId },
    data: {
      status: "CONFIRMED",
      subscriptionId: sub.id,
    },
  });

  return NextResponse.json({ ok: true });
}
