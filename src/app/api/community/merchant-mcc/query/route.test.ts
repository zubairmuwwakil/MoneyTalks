import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordCommunityMerchantMCCQuery } from "@/lib/observability";
import { GET, POST } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communityMerchantMCCObservation: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/observability", () => ({ recordCommunityMerchantMCCQuery: vi.fn() }));

const busyCandidate = { merchantId: "busy-store", placeId: "busy-location", channel: "inStore" as const };
const quietCandidate = { merchantId: "quiet-store", placeId: "quiet-location", channel: "inStore" as const };

function row(candidate: typeof busyCandidate, observedAt: string, mcc = 5411) {
  return {
    merchantId: candidate.merchantId,
    placeId: candidate.placeId,
    latitude: null,
    longitude: null,
    channel: candidate.channel,
    network: "mastercard",
    mcc,
    observedAt: new Date(observedAt),
  };
}

function queryRequest() {
  return new NextRequest("https://example.test/api/community/merchant-mcc/query", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: 1, candidates: [busyCandidate, quietCandidate] }),
  });
}

describe("community merchant MCC query", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T18:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("reads each candidate independently so a capped busy scope cannot starve another signal", async () => {
    const busyRows = Array.from({ length: 2_173 }, () => row(busyCandidate, "2026-09-04T12:00:00.000Z"));
    const quietRows = [
      row(quietCandidate, "2026-09-02T12:00:00.000Z"),
      row(quietCandidate, "2026-09-03T12:00:00.000Z"),
      row(quietCandidate, "2026-09-04T12:00:00.000Z"),
    ];
    vi.mocked(prisma.communityMerchantMCCObservation.findMany)
      .mockResolvedValueOnce(busyRows as never)
      .mockResolvedValueOnce(quietRows as never);

    const response = await POST(queryRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 1,
      signals: [expect.objectContaining({ merchantId: quietCandidate.merchantId, mcc: 5411, supportDays: 3 })],
    });
    expect(prisma.communityMerchantMCCObservation.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.communityMerchantMCCObservation.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ merchantId: busyCandidate.merchantId }),
      take: 2_173,
    }));
    expect(prisma.communityMerchantMCCObservation.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ merchantId: quietCandidate.merchantId }),
      take: 2_173,
    }));
    expect(recordCommunityMerchantMCCQuery).toHaveBeenCalledWith({
      outcome: "success",
      candidates: 2,
      signals: 1,
      truncatedCandidates: 1,
    });
  });

  it("uses a constant-cost table probe while preserving the health response", async () => {
    vi.mocked(prisma.communityMerchantMCCObservation.findFirst).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, schemaVersion: 1 });
    expect(prisma.communityMerchantMCCObservation.findFirst).toHaveBeenCalledWith({ select: { id: true } });
  });
});
