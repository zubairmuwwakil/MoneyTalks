import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  COMMUNITY_MCC_RETENTION_DAYS,
  communityMerchantMCCSubmissionSchema,
  normalizeCommunityMerchantId,
  roundedCommunityMCCCoordinate,
} from "@/lib/community-merchant-mcc";

const MAX_BODY_BYTES = 8_192;
const MAX_SUBMISSION_AGE_DAYS = 30;
const MAX_STORED_REPORTS_PER_SCOPE_DAY = 12;

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

  const parsed = communityMerchantMCCSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_observation" }, { status: 400 });
  }

  const now = Date.now();
  const observedAt = new Date(parsed.data.observedAt);
  if (observedAt.getTime() > now + 10 * 60_000
      || observedAt.getTime() < now - MAX_SUBMISSION_AGE_DAYS * 86_400_000) {
    return NextResponse.json({ error: "observation_time_out_of_range" }, { status: 400 });
  }

  const merchantId = normalizeCommunityMerchantId(parsed.data.merchantId);
  const hasPlaceId = Boolean(parsed.data.placeId);
  const placeId = parsed.data.placeId?.trim() || null;
  const latitude = hasPlaceId || parsed.data.latitude === undefined
    ? null : roundedCommunityMCCCoordinate(parsed.data.latitude);
  const longitude = hasPlaceId || parsed.data.longitude === undefined
    ? null : roundedCommunityMCCCoordinate(parsed.data.longitude);

  // Raw rows deliberately contain no contributor identifier, so influence caps alone are not
  // enough: random observation UUIDs could otherwise bloat one store's storage/query window.
  // Bound raw retention at the same physical scope. Twelve rows/day preserves room for genuine
  // conflicting reports while making one-day request floods unable to crowd months of history out.
  const dayStart = new Date(Date.UTC(
    observedAt.getUTCFullYear(), observedAt.getUTCMonth(), observedAt.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const scopeLocation: Prisma.CommunityMerchantMCCObservationWhereInput = hasPlaceId
    ? { placeId }
    : { placeId: null, latitude, longitude };
  try {
    const storedToday = await prisma.communityMerchantMCCObservation.count({
      where: {
        merchantId,
        channel: parsed.data.channel,
        observedAt: { gte: dayStart, lt: dayEnd },
        ...scopeLocation,
      },
    });
    if (storedToday >= MAX_STORED_REPORTS_PER_SCOPE_DAY) {
      return NextResponse.json({ ok: true, capped: true });
    }

    await prisma.communityMerchantMCCObservation.create({
      data: {
        id: parsed.data.observationId,
        merchantId,
        placeId,
        latitude,
        longitude,
        channel: parsed.data.channel,
        network: parsed.data.network ?? null,
        mcc: parsed.data.mcc,
        observedAt,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("community merchant MCC submit failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const cutoff = new Date(now - COMMUNITY_MCC_RETENTION_DAYS * 86_400_000);
  await prisma.communityMerchantMCCObservation.deleteMany({ where: { observedAt: { lt: cutoff } } });

  return NextResponse.json({ ok: true });
}
