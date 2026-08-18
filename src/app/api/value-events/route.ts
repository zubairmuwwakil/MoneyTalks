import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { ValueEventType } from "@prisma/client";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

export const runtime = "nodejs";

function isValidType(value: unknown): value is ValueEventType {
  return typeof value === "string" && (Object.values(ValueEventType) as string[]).includes(value);
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { type, amountCents, currency, occurredAt, sourceId, isEstimated } = body;

  if (!isValidType(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "amountCents must be a positive number" }, { status: 400 });
  }
  const currencyCode = typeof currency === "string" ? normalizeCurrencyCode(currency) : null;
  if (!currencyCode) {
    return NextResponse.json({ error: "currency is required" }, { status: 400 });
  }

  const occurredDate = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(occurredDate.getTime())) {
    return NextResponse.json({ error: "occurredAt is not a valid date" }, { status: 400 });
  }

  try {
    const event = await prisma.valueEvent.create({
      data: {
        userId,
        type,
        amountCents: Math.round(amountCents),
        currency: currencyCode,
        occurredAt: occurredDate,
        sourceId: typeof sourceId === "string" && sourceId.length ? sourceId : null,
        isEstimated: Boolean(isEstimated),
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error("value-event create error", error);
    return NextResponse.json({ error: "Failed to record value event" }, { status: 500 });
  }
}
