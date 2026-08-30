import { type NextRequest, NextResponse } from "next/server";

import { confirmMerchantCurrency } from "@/lib/domain/recurring/confirmMerchantCurrency";
import { sweepRecurringObligations } from "@/lib/domain/recurring/detectRecurring";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

export const runtime = "nodejs";

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

/**
 * Teaches a merchant from the pre-obligation review lane. The merchant must
 * still have one of this owner's priced, unresolved purchases; this is not a
 * global merchant fact and never creates a default for unrelated owners.
 */
export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null) as { merchantCanonicalId?: unknown; currency?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const merchantCanonicalId = nonEmptyString(body.merchantCanonicalId);
  const currency = currencyCode(body.currency);
  if (!merchantCanonicalId) return NextResponse.json({ error: "merchantCanonicalId is required" }, { status: 400 });
  if (!currency) return NextResponse.json({ error: "Currency must be a three-letter code" }, { status: 400 });

  const unresolvedPurchase = await prisma.purchase.findFirst({
    where: {
      userId,
      merchant: merchantCanonicalId,
      totalCents: { not: null },
      currency: null,
    },
    select: { id: true },
  });
  if (!unresolvedPurchase) return new NextResponse("Not found", { status: 404 });

  const { affectedPurchases } = await confirmMerchantCurrency(prisma, {
    userId,
    merchantCanonicalId,
    currency,
  });
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
