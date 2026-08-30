import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { recurringObligation: { findMany: vi.fn() } },
}));

describe("GET /api/recurring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.recurringObligation.findMany).mockResolvedValue([{
      id: "obligation-1",
      userId: "user-1",
      merchantCanonicalId: "netflix.com",
      status: "ACTIVE",
      confidence: 0.55,
      confidenceReasons: [{ code: "REGULAR_OCCURRENCES", delta: 0.35, detail: "3 Netflix charges, about 30 days apart." }],
      evidence: [
        { id: "evidence-1", occurredAt: new Date("2026-05-11T12:00:00.000Z") },
        { id: "evidence-2", occurredAt: new Date("2026-06-11T12:00:00.000Z") },
        { id: "evidence-3", occurredAt: new Date("2026-07-11T12:00:00.000Z") },
      ],
    }] as never);
  });

  it("lists detected obligations with readable reasons and evidence", async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.obligations[0]).toMatchObject({
      merchantCanonicalId: "netflix.com",
      status: "ACTIVE",
      confidence: expect.any(Number),
    });
    expect(body.obligations[0].reasons[0]).toEqual({
      code: "REGULAR_OCCURRENCES",
      detail: "3 Netflix charges, about 30 days apart.",
    });
    expect(body.obligations[0].evidence).toHaveLength(3);
    expect(body.obligations[0]).not.toHaveProperty("confidenceReasons");
  });

  it("scopes the review query to the requesting owner", async () => {
    await GET();

    expect(prisma.recurringObligation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", origin: "DETECTED", needsReview: true },
    }));
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(prisma.recurringObligation.findMany).not.toHaveBeenCalled();
  });
});
