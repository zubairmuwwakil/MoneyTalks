import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  COMMUNITY_MCC_MAX_STORED_REPORTS_PER_SCOPE_DAY,
  COMMUNITY_MCC_RETENTION_DAYS,
  aggregateCommunityMerchantMCC,
  communityMerchantMCCCandidateKey,
  communityMerchantMCCQuerySchema,
  normalizedCommunityMCCCandidate,
} from "@/lib/community-merchant-mcc";
import { recordCommunityMerchantMCCQuery } from "@/lib/observability";

const MAX_BODY_BYTES = 16_384;
// An elapsed 180-day window can touch 181 UTC dates. Read one extra row per scope
// as a sentinel so a rare cap overage is observable without silently dropping it.
const MAX_ROWS_PER_CANDIDATE = (COMMUNITY_MCC_RETENTION_DAYS + 1)
  * COMMUNITY_MCC_MAX_STORED_REPORTS_PER_SCOPE_DAY;

/**
 * Read-only production health probe for the anonymous MCC evidence table.
 * A successful response proves the deployed route can reach the database and
 * that Prisma can query the migrated table. It deliberately exposes no row
 * counts or merchant data.
 */
export async function GET() {
  try {
    await prisma.communityMerchantMCCObservation.findFirst({ select: { id: true } });
    recordCommunityMerchantMCCQuery({ outcome: "health_success" });
    return NextResponse.json({ ok: true, schemaVersion: 1 });
  } catch (error) {
    recordCommunityMerchantMCCQuery({ outcome: "health_failed" });
    console.error("community merchant MCC health check failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    recordCommunityMerchantMCCQuery({ outcome: "payload_too_large" });
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    recordCommunityMerchantMCCQuery({ outcome: "invalid_json" });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = communityMerchantMCCQuerySchema.safeParse(body);
  if (!parsed.success) {
    recordCommunityMerchantMCCQuery({ outcome: "invalid_query" });
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const candidates = parsed.data.candidates.map(normalizedCommunityMCCCandidate);
  // Equivalent candidates must share one read; an OR query naturally deduplicated them, while
  // concatenating per-candidate reads would otherwise double their evidence during aggregation.
  const uniqueCandidates = [...new Map(candidates.map(candidate => [
    communityMerchantMCCCandidateKey(candidate),
    candidate,
  ])).values()];
  const cutoff = new Date(Date.now() - COMMUNITY_MCC_RETENTION_DAYS * 86_400_000);

  try {
    const candidateRows = await Promise.all(uniqueCandidates.map(candidate =>
      prisma.communityMerchantMCCObservation.findMany({
        where: {
          observedAt: { gte: cutoff },
          merchantId: candidate.merchantId,
          channel: candidate.channel,
          ...(candidate.placeId
            ? { placeId: candidate.placeId }
            : {
                placeId: null,
                latitude: candidate.latitude!,
                longitude: candidate.longitude!,
              }),
        },
        select: {
          merchantId: true,
          placeId: true,
          latitude: true,
          longitude: true,
          channel: true,
          network: true,
          mcc: true,
          observedAt: true,
        },
        take: MAX_ROWS_PER_CANDIDATE + 1,
        orderBy: { observedAt: "desc" },
      }),
    ));
    const truncatedCandidates = candidateRows.filter(rows => rows.length > MAX_ROWS_PER_CANDIDATE).length;
    const rows = candidateRows.flatMap(candidateRows => candidateRows.slice(0, MAX_ROWS_PER_CANDIDATE));

    const signals = aggregateCommunityMerchantMCC(rows, parsed.data.candidates);
    recordCommunityMerchantMCCQuery({
      outcome: "success",
      candidates: candidates.length,
      signals: signals.length,
      truncatedCandidates,
    });
    return NextResponse.json({ schemaVersion: 1, signals });
  } catch (error) {
    recordCommunityMerchantMCCQuery({ outcome: "failed", candidates: candidates.length });
    console.error("community merchant MCC query failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
