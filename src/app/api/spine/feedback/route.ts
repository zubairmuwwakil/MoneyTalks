import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const feedback = await prisma.walletEvent.findMany({
    where: { userId, feedbackVerdict: { not: null } },
    orderBy: { capturedAt: "desc" },
    take: 50,
    select: {
      eventId: true,
      capturedAt: true,
      merchantRaw: true,
      amountRaw: true,
      currencyRaw: true,
      cardRaw: true,
      feedbackVerdict: true,
      feedbackWarning: true,
    },
  });

  return NextResponse.json({
    feedback: feedback.map((event) => ({
      eventId: event.eventId,
      capturedAt: event.capturedAt.toISOString(),
      merchantRaw: event.merchantRaw,
      amountMinor: event.amountRaw == null ? null : Math.round(event.amountRaw * 100),
      currency: event.currencyRaw,
      cardRaw: event.cardRaw,
      verdict: event.feedbackVerdict,
      warning: event.feedbackWarning,
    })),
  });
}
