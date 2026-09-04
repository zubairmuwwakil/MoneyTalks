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

  const hasPlaceId = Boolean(parsed.data.placeId);
  try {
    await prisma.communityMerchantMCCObservation.create({
      data: {
        id: parsed.data.observationId,
        merchantId: normalizeCommunityMerchantId(parsed.data.merchantId),
        placeId: parsed.data.placeId?.trim() || null,
        latitude: hasPlaceId || parsed.data.latitude === undefined
          ? null : roundedCommunityMCCCoordinate(parsed.data.latitude),
        longitude: hasPlaceId || parsed.data.longitude === undefined
          ? null : roundedCommunityMCCCoordinate(parsed.data.longitude),
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
