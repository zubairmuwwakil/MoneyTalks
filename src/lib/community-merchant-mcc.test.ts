import { describe, expect, it } from "vitest";
import {
  aggregateCommunityMerchantMCC,
  communityMerchantMCCCandidateKey,
  communityMerchantMCCQuerySchema,
  communityMerchantMCCSubmissionSchema,
  normalizedCommunityMCCCandidate,
} from "./community-merchant-mcc";

const candidate = {
  merchantId: "walmart",
  placeId: "apple-walmart-1",
  channel: "inStore" as const,
};

function row(day: string, mcc: number, network = "mastercard") {
  return {
    merchantId: "walmart",
    placeId: "apple-walmart-1",
    latitude: null,
    longitude: null,
    channel: "inStore",
    network,
    mcc,
    observedAt: new Date(`${day}T12:00:00Z`),
  };
}

describe("community merchant MCC", () => {
  it("accepts the schema-v1 coordinate submission PickMe sends", () => {
    const parsed = communityMerchantMCCSubmissionSchema.safeParse({
      schemaVersion: 1,
      observationId: "037b4c16-a6b0-4bc4-a67e-69199fa82a8e",
      merchantId: "walmart",
      latitude: 43.8496,
      longitude: -79.0196,
      channel: "inStore",
      network: "mastercard",
      mcc: 5411,
      observedAt: "2026-09-04T16:00:00-04:00",
    });

    expect(parsed.success).toBe(true);
  });

  it("normalizes PickMe query coordinates to the shared three-decimal privacy bucket", () => {
    const parsed = communityMerchantMCCQuerySchema.parse({
      schemaVersion: 1,
      candidates: [{
        merchantId: "walmart",
        latitude: 43.8496,
        longitude: -79.0196,
        channel: "inStore",
      }],
    });
    const normalized = normalizedCommunityMCCCandidate(parsed.candidates[0]);

    expect(normalized).toMatchObject({
      merchantId: "walmart",
      placeId: null,
      latitude: 43.85,
      longitude: -79.02,
      channel: "inStore",
    });
    expect(communityMerchantMCCCandidateKey(normalized))
      .toBe("c:walmart:43.850:-79.020|ch:inStore");
  });

  it("requires a physical location for in-store submissions", () => {
    const parsed = communityMerchantMCCSubmissionSchema.safeParse({
      schemaVersion: 1,
      observationId: "037b4c16-a6b0-4bc4-a67e-69199fa82a8e",
      merchantId: "walmart",
      channel: "inStore",
      network: "mastercard",
      mcc: 5411,
      observedAt: "2026-09-04T16:00:00Z",
    });
    expect(parsed.success).toBe(false);
  });

  it("does not expose one-off or two-day evidence", () => {
    const now = new Date("2026-09-04T18:00:00Z");
    expect(aggregateCommunityMerchantMCC([
      row("2026-09-03", 5411),
      row("2026-09-04", 5411),
    ], [candidate], now)).toEqual([]);
  });

  it("publishes only after three distinct support days", () => {
    const now = new Date("2026-09-04T18:00:00Z");
    const signals = aggregateCommunityMerchantMCC([
      row("2026-09-02", 5411),
      row("2026-09-03", 5411),
      row("2026-09-04", 5411),
    ], [candidate], now);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      merchantId: "walmart",
      mcc: 5411,
      supportDays: 3,
      supportUnits: 3,
      totalUnits: 3,
      confidence: 1,
    });
  });

  it("caps a same-day burst so it cannot replace multi-day corroboration", () => {
    const now = new Date("2026-09-04T18:00:00Z");
    const burst = Array.from({ length: 20 }, () => row("2026-09-04", 5411));
    expect(aggregateCommunityMerchantMCC(burst, [candidate], now)).toEqual([]);
  });

  it("keeps conflicting MCCs fractional instead of selecting the latest write", () => {
    const now = new Date("2026-09-04T18:00:00Z");
    const signals = aggregateCommunityMerchantMCC([
      row("2026-08-30", 5411), row("2026-08-31", 5411), row("2026-09-01", 5411),
      row("2026-09-02", 5310), row("2026-09-03", 5310), row("2026-09-04", 5310),
    ], [candidate], now);

    expect(signals).toHaveLength(2);
    expect(signals.map(signal => [signal.mcc, signal.confidence])).toEqual(expect.arrayContaining([
      [5411, 0.5],
      [5310, 0.5],
    ]));
  });
});
