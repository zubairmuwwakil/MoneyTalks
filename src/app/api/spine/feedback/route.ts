import { getSessionUserId } from "@/lib/require-user";
import { walletAmountMinor } from "@/lib/domain/wallet/amount";
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
      capturedAtRaw: true,
      capturedTimezone: true,
      merchantRaw: true,
      merchantNormalized: true,
      amountRaw: true,
      currencyRaw: true,
      cardRaw: true,
      resolvedCardId: true,
      feedbackVerdict: true,
      feedbackWarning: true,
    },
  });

  return NextResponse.json({
    feedback: feedback.map((event) => ({
      eventId: event.eventId,
      capturedAt: event.capturedAt.toISOString(),
      capturedAtRaw: event.capturedAtRaw,
      capturedTimezone: event.capturedTimezone,
      merchantRaw: event.merchantRaw,
      merchantNormalized: event.merchantNormalized,
      amountMinor: walletAmountMinor(event.amountRaw),
      currency: event.currencyRaw,
      cardRaw: event.cardRaw,
      resolvedCardId: event.resolvedCardId,
      verdict: event.feedbackVerdict,
      warning: event.feedbackWarning,
    })),
  });
}
