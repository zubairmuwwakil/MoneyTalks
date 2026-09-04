import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  COMMUNITY_INVENTORY_RETENTION_DAYS,
  communityInventorySubmissionSchema,
  normalizeCommunityKey,
  roundedCommunityCoordinate,
} from "@/lib/community-gift-card-inventory";

const MAX_BODY_BYTES = 8_192;

export async function POST(req: NextRequest) {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = communityInventorySubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_observation" }, { status: 400 });
  }

  const now = Date.now();
  const observedAt = new Date(parsed.data.observedAt);
  if (observedAt.getTime() > now + 10 * 60_000 || observedAt.getTime() < now - 30 * 86_400_000) {
    return NextResponse.json({ error: "observation_time_out_of_range" }, { status: 400 });
  }

  try {
    await prisma.communityGiftCardInventoryObservation.create({
      data: {
        id: parsed.data.observationId,
        merchantKey: normalizeCommunityKey(parsed.data.merchantKey),
        placeId: parsed.data.placeId?.trim() || null,
        latitude: parsed.data.latitude === undefined ? null : roundedCommunityCoordinate(parsed.data.latitude),
        longitude: parsed.data.longitude === undefined ? null : roundedCommunityCoordinate(parsed.data.longitude),
        instrumentKey: normalizeCommunityKey(parsed.data.instrumentKey),
        availability: parsed.data.availability,
        observedAt,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("community gift-card inventory submit failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Keep raw anonymous reports bounded. Query output is already day-aggregated and PickMe owns the
  // confidence model, so old raw rows have no product value.
  const cutoff = new Date(now - COMMUNITY_INVENTORY_RETENTION_DAYS * 86_400_000);
  await prisma.communityGiftCardInventoryObservation.deleteMany({ where: { observedAt: { lt: cutoff } } });

  return NextResponse.json({ ok: true });
}
