import { z } from "zod";

export const COMMUNITY_INVENTORY_RETENTION_DAYS = 90;
export const COMMUNITY_INVENTORY_DAILY_EVIDENCE_CAP = 3;

const locationShape = {
  merchantKey: z.string().trim().min(1).max(160),
  placeId: z.string().trim().min(1).max(255).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
};

function hasLocation(value: { placeId?: string; latitude?: number; longitude?: number }) {
  return Boolean(value.placeId) || (value.latitude !== undefined && value.longitude !== undefined);
}

export const communityInventorySubmissionSchema = z.object({
  schemaVersion: z.literal(1),
  observationId: z.string().uuid(),
  ...locationShape,
  instrumentKey: z.string().trim().min(1).max(200),
  availability: z.enum(["available", "unavailable"]),
  observedAt: z.iso.datetime({ offset: true }),
}).superRefine((value, ctx) => {
  if (!hasLocation(value)) {
    ctx.addIssue({ code: "custom", message: "placeId or latitude+longitude is required" });
  }
});

export const communityInventoryQuerySchema = z.object({
  schemaVersion: z.literal(1),
  instrumentKey: z.string().trim().min(1).max(200),
  candidates: z.array(z.object(locationShape).superRefine((value, ctx) => {
    if (!hasLocation(value)) {
      ctx.addIssue({ code: "custom", message: "placeId or latitude+longitude is required" });
    }
  })).min(1).max(25),
});

export type CommunityInventoryCandidate = z.infer<typeof communityInventoryQuerySchema>["candidates"][number];

export type CommunityInventoryRow = {
  merchantKey: string;
  placeId: string | null;
  latitude: unknown;
  longitude: unknown;
  availability: string;
  observedAt: Date;
};

export type CommunityInventorySignal = {
  candidateKey: string;
  merchantKey: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  day: string;
  availableUnits: number;
  unavailableUnits: number;
};

export function normalizeCommunityKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function roundedCommunityCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function normalizedCommunityCandidate(candidate: CommunityInventoryCandidate) {
  return {
    merchantKey: normalizeCommunityKey(candidate.merchantKey),
    placeId: candidate.placeId?.trim() || null,
    latitude: candidate.latitude === undefined ? null : roundedCommunityCoordinate(candidate.latitude),
    longitude: candidate.longitude === undefined ? null : roundedCommunityCoordinate(candidate.longitude),
  };
}

export function communityCandidateKey(candidate: {
  merchantKey: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
}): string {
  if (candidate.placeId) return `p:${candidate.placeId}`;
  return `c:${candidate.merchantKey}:${candidate.latitude?.toFixed(4)}:${candidate.longitude?.toFixed(4)}`;
}

function rowCandidateKey(row: CommunityInventoryRow): string | null {
  const placeId = row.placeId?.trim() || null;
  if (placeId) return `p:${placeId}`;
  const latitude = row.latitude == null ? null : roundedCommunityCoordinate(Number(row.latitude));
  const longitude = row.longitude == null ? null : roundedCommunityCoordinate(Number(row.longitude));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return communityCandidateKey({
    merchantKey: normalizeCommunityKey(row.merchantKey),
    placeId: null,
    latitude,
    longitude,
  });
}

/// Converts raw reports into a privacy-minimal, bounded signal. PickMe remains responsible for
/// freshness/confidence semantics. This layer only ensures that one noisy day cannot contribute
/// more than three evidence units for a store+gift-card pair.
export function aggregateCommunityInventory(
  rows: CommunityInventoryRow[],
  candidates: CommunityInventoryCandidate[],
  now = new Date(),
): CommunityInventorySignal[] {
  const normalizedCandidates = candidates.map(normalizedCommunityCandidate);
  const byKey = new Map(normalizedCandidates.map(candidate => [communityCandidateKey(candidate), candidate]));
  const cutoff = now.getTime() - COMMUNITY_INVENTORY_RETENTION_DAYS * 86_400_000;
  const daily = new Map<string, { candidateKey: string; day: string; available: number; unavailable: number }>();

  for (const row of rows) {
    if (row.observedAt.getTime() < cutoff || row.observedAt.getTime() > now.getTime() + 600_000) continue;
    const candidateKey = rowCandidateKey(row);
    if (!candidateKey || !byKey.has(candidateKey)) continue;
    if (row.availability !== "available" && row.availability !== "unavailable") continue;
    const day = row.observedAt.toISOString().slice(0, 10);
    const key = `${candidateKey}|${day}`;
    const bucket = daily.get(key) ?? { candidateKey, day, available: 0, unavailable: 0 };
    if (row.availability === "available") bucket.available += 1;
    else bucket.unavailable += 1;
    daily.set(key, bucket);
  }

  return [...daily.values()].map(bucket => {
    const candidate = byKey.get(bucket.candidateKey)!;
    const reports = bucket.available + bucket.unavailable;
    const units = Math.min(COMMUNITY_INVENTORY_DAILY_EVIDENCE_CAP, reports);
    const availableUnits = reports === 0 ? 0 : Math.round(units * bucket.available / reports);
    const unavailableUnits = units - availableUnits;
    return {
      candidateKey: bucket.candidateKey,
      merchantKey: candidate.merchantKey,
      placeId: candidate.placeId,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      day: bucket.day,
      availableUnits,
      unavailableUnits,
    };
  }).sort((a, b) => b.day.localeCompare(a.day) || a.candidateKey.localeCompare(b.candidateKey));
}
