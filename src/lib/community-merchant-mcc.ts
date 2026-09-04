import { z } from "zod";

export const COMMUNITY_MCC_RETENTION_DAYS = 180;
export const COMMUNITY_MCC_MIN_SUPPORT_DAYS = 3;
export const COMMUNITY_MCC_DAILY_EVIDENCE_CAP = 2;

const merchantId = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const channel = z.enum(["inStore", "online", "app", "unknown"]);
const network = z.enum(["amex", "visa", "mastercard", "discover"]).optional();
const locationShape = {
  placeId: z.string().trim().min(1).max(255).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
};

function hasLocation(value: { placeId?: string; latitude?: number; longitude?: number }) {
  return Boolean(value.placeId) || (value.latitude !== undefined && value.longitude !== undefined);
}

export const communityMerchantMCCSubmissionSchema = z.object({
  schemaVersion: z.literal(1),
  observationId: z.string().uuid(),
  merchantId,
  ...locationShape,
  channel,
  network,
  mcc: z.number().int().min(0).max(9999),
  observedAt: z.iso.datetime({ offset: true }),
}).superRefine((value, ctx) => {
  if ((value.channel === "inStore" || value.channel === "unknown") && !hasLocation(value)) {
    ctx.addIssue({ code: "custom", message: "physical channel requires placeId or latitude+longitude" });
  }
});

export const communityMerchantMCCQuerySchema = z.object({
  schemaVersion: z.literal(1),
  candidates: z.array(z.object({
    merchantId,
    ...locationShape,
    channel,
  }).superRefine((value, ctx) => {
    if ((value.channel === "inStore" || value.channel === "unknown") && !hasLocation(value)) {
      ctx.addIssue({ code: "custom", message: "physical channel requires placeId or latitude+longitude" });
    }
  })).min(1).max(25),
});

export type CommunityMerchantMCCCandidate = z.infer<typeof communityMerchantMCCQuerySchema>["candidates"][number];
export type CommunityMerchantMCCRow = {
  merchantId: string;
  placeId: string | null;
  latitude: unknown;
  longitude: unknown;
  channel: string;
  network: string | null;
  mcc: number;
  observedAt: Date;
};

export type CommunityMerchantMCCSignal = {
  candidateKey: string;
  merchantId: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  channel: "inStore" | "online" | "app" | "unknown";
  network: string | null;
  mcc: number;
  supportDays: number;
  supportUnits: number;
  totalUnits: number;
  confidence: number;
  latestDay: string;
};

export function normalizeCommunityMerchantId(value: string): string {
  return value.trim().toLowerCase();
}

export function roundedCommunityMCCCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function normalizedCommunityMCCCandidate(candidate: CommunityMerchantMCCCandidate) {
  return {
    merchantId: normalizeCommunityMerchantId(candidate.merchantId),
    placeId: candidate.placeId?.trim() || null,
    latitude: candidate.latitude === undefined ? null : roundedCommunityMCCCoordinate(candidate.latitude),
    longitude: candidate.longitude === undefined ? null : roundedCommunityMCCCoordinate(candidate.longitude),
    channel: candidate.channel,
  };
}

export function communityMerchantMCCCandidateKey(candidate: {
  merchantId: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  channel: string;
}): string {
  const location = candidate.placeId
    ? `p:${candidate.placeId}`
    : candidate.latitude !== null && candidate.longitude !== null
      ? `c:${candidate.merchantId}:${candidate.latitude.toFixed(4)}:${candidate.longitude.toFixed(4)}`
      : `m:${candidate.merchantId}`;
  return `${location}|ch:${candidate.channel}`;
}

function rowCandidateKey(row: CommunityMerchantMCCRow): string | null {
  const latitude = row.latitude == null ? null : roundedCommunityMCCCoordinate(Number(row.latitude));
  const longitude = row.longitude == null ? null : roundedCommunityMCCCoordinate(Number(row.longitude));
  if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) return null;
  return communityMerchantMCCCandidateKey({
    merchantId: normalizeCommunityMerchantId(row.merchantId),
    placeId: row.placeId?.trim() || null,
    latitude,
    longitude,
    channel: row.channel,
  });
}

/**
 * Raw reports contain no user/account/device/contributor identifier. To keep a single noisy burst
 * from becoming shared truth, each store+network+MCC contributes at most two units per UTC day and
 * an MCC is not published until it has support on at least three distinct days. PickMe still treats
 * the result as external evidence, never as an owner-observed/trusted MCC.
 */
export function aggregateCommunityMerchantMCC(
  rows: CommunityMerchantMCCRow[],
  candidates: CommunityMerchantMCCCandidate[],
  now = new Date(),
): CommunityMerchantMCCSignal[] {
  const normalizedCandidates = candidates.map(normalizedCommunityMCCCandidate);
  const byKey = new Map(normalizedCandidates.map(c => [communityMerchantMCCCandidateKey(c), c]));
  const cutoff = now.getTime() - COMMUNITY_MCC_RETENTION_DAYS * 86_400_000;
  const daily = new Map<string, { candidateKey: string; network: string | null; mcc: number; day: string; count: number; latest: Date }>();

  for (const row of rows) {
    const time = row.observedAt.getTime();
    if (time < cutoff || time > now.getTime() + 600_000) continue;
    const candidateKey = rowCandidateKey(row);
    if (!candidateKey || !byKey.has(candidateKey)) continue;
    if (!Number.isInteger(row.mcc) || row.mcc < 0 || row.mcc > 9999) continue;
    const networkValue = row.network?.toLowerCase() || null;
    const day = row.observedAt.toISOString().slice(0, 10);
    const key = `${candidateKey}|n:${networkValue ?? "unknown"}|m:${row.mcc}|d:${day}`;
    const bucket = daily.get(key) ?? { candidateKey, network: networkValue, mcc: row.mcc, day, count: 0, latest: row.observedAt };
    bucket.count += 1;
    if (row.observedAt > bucket.latest) bucket.latest = row.observedAt;
    daily.set(key, bucket);
  }

  type Aggregate = { candidateKey: string; network: string | null; mcc: number; days: Set<string>; units: number; latest: Date };
  const byMcc = new Map<string, Aggregate>();
  const totals = new Map<string, number>();
  for (const bucket of daily.values()) {
    const units = Math.min(COMMUNITY_MCC_DAILY_EVIDENCE_CAP, bucket.count);
    const scope = `${bucket.candidateKey}|n:${bucket.network ?? "unknown"}`;
    totals.set(scope, (totals.get(scope) ?? 0) + units);
    const key = `${scope}|m:${bucket.mcc}`;
    const aggregate = byMcc.get(key) ?? { candidateKey: bucket.candidateKey, network: bucket.network, mcc: bucket.mcc, days: new Set<string>(), units: 0, latest: bucket.latest };
    aggregate.days.add(bucket.day);
    aggregate.units += units;
    if (bucket.latest > aggregate.latest) aggregate.latest = bucket.latest;
    byMcc.set(key, aggregate);
  }

  const signals: CommunityMerchantMCCSignal[] = [];
  for (const aggregate of byMcc.values()) {
    if (aggregate.days.size < COMMUNITY_MCC_MIN_SUPPORT_DAYS) continue;
    const candidate = byKey.get(aggregate.candidateKey)!;
    const totalUnits = totals.get(`${aggregate.candidateKey}|n:${aggregate.network ?? "unknown"}`) ?? aggregate.units;
    signals.push({
      candidateKey: aggregate.candidateKey,
      merchantId: candidate.merchantId,
      placeId: candidate.placeId,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      channel: candidate.channel,
      network: aggregate.network,
      mcc: aggregate.mcc,
      supportDays: aggregate.days.size,
      supportUnits: aggregate.units,
      totalUnits,
      confidence: totalUnits === 0 ? 0 : aggregate.units / totalUnits,
      latestDay: aggregate.latest.toISOString().slice(0, 10),
    });
  }

  return signals.sort((a, b) => b.latestDay.localeCompare(a.latestDay) || a.candidateKey.localeCompare(b.candidateKey) || a.mcc - b.mcc);
}
