import { Prisma } from "@prisma/client";
import { type NextRequest, NextResponse } from "next/server";

import { confirmMerchantCurrency } from "@/lib/domain/recurring/confirmMerchantCurrency";
import { sweepRecurringObligations } from "@/lib/domain/recurring/detectRecurring";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

type RecurringAction = "confirm" | "dismiss" | "exclude-evidence" | "set-currency";
type ActionBody = {
  action?: RecurringAction;
  dismissReason?: unknown;
  evidenceId?: unknown;
  currency?: unknown;
};

const DEFAULT_TIME_ZONE = "America/Toronto";

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function currencyCode(value: unknown): string | null {
  const normalized = nonEmptyString(value)?.toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null) as ActionBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  if (!body.action || !["confirm", "dismiss", "exclude-evidence", "set-currency"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { id } = await params;

  if (body.action === "set-currency") {
    const currency = currencyCode(body.currency);
    if (!currency) return NextResponse.json({ error: "Currency must be a three-letter code" }, { status: 400 });

    const obligation = await prisma.recurringObligation.findFirst({
      where: { id, userId, origin: "DETECTED", needsReview: true },
      select: { merchantCanonicalId: true },
    });
    if (!obligation) return new NextResponse("Not found", { status: 404 });

    const { affectedPurchases } = await confirmMerchantCurrency(prisma, {
      userId,
      merchantCanonicalId: obligation.merchantCanonicalId,
      currency,
    }, { replaceLearnedPurchases: true });

    const preference = await prisma.notificationPreference.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    await sweepRecurringObligations(prisma, {
      userId,
      timeZone: preference?.timezone || DEFAULT_TIME_ZONE,
      algorithmVersion: 1,
    });
    return NextResponse.json({ ok: true, affectedPurchases });
  }

  if (body.action === "exclude-evidence") {
    const evidenceId = nonEmptyString(body.evidenceId);
    if (!evidenceId) return NextResponse.json({ error: "evidenceId is required" }, { status: 400 });
    const updated = await prisma.recurringObligationEvidence.updateMany({
      where: {
        id: evidenceId,
        obligationId: id,
        obligation: { userId },
      },
      data: { excludedByUser: true },
    });
    if (updated.count === 0) return new NextResponse("Evidence not found", { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const dismissReason = body.action === "dismiss" ? nonEmptyString(body.dismissReason) : null;
  if (body.action === "dismiss" && !dismissReason) {
    return NextResponse.json({ error: "A dismissal reason is required" }, { status: 400 });
  }
  if (dismissReason && dismissReason.length > 200) {
    return NextResponse.json({ error: "Dismissal reason must be 200 characters or fewer" }, { status: 400 });
  }

  // Snapshot the live score in the same row write that records the decision.
  // A read followed by an ORM update leaves a race in which a sweep can replace
  // confidence between those two operations and corrupt the P8 label.
  const decision = body.action === "confirm"
    ? Prisma.sql`
        UPDATE "RecurringObligation"
        SET "needsReview" = false,
            "confirmedAt" = CURRENT_TIMESTAMP,
            "dismissedAt" = NULL,
            "dismissReason" = NULL,
            "decidedConfidence" = confidence,
            "decidedReasons" = "confidenceReasons",
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${id}
          AND "userId" = ${userId}
          AND "needsReview" = true
          AND "confirmedAt" IS NULL
          AND "dismissedAt" IS NULL
        RETURNING id
      `
    : Prisma.sql`
        UPDATE "RecurringObligation"
        SET "needsReview" = false,
            "confirmedAt" = NULL,
            "dismissedAt" = CURRENT_TIMESTAMP,
            "dismissReason" = ${dismissReason},
            "decidedConfidence" = confidence,
            "decidedReasons" = "confidenceReasons",
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${id}
          AND "userId" = ${userId}
          AND "needsReview" = true
          AND "confirmedAt" IS NULL
          AND "dismissedAt" IS NULL
        RETURNING id
      `;
  const updated = await prisma.$queryRaw<Array<{ id: string }>>(decision);
  if (updated.length === 0) {
    const existing = await prisma.recurringObligation.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return new NextResponse("Not found", { status: 404 });
    return NextResponse.json({ ok: true, alreadyHandled: true });
  }

  return NextResponse.json({ ok: true });
}
