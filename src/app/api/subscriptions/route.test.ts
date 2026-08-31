import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/domain/recurring/ownerFacts", () => ({ createOwnerSubscription: vi.fn() }));
vi.mock("@/lib/domain/notifications/eventNotificationScheduler", () => ({ scheduleRecurringObligationRenewalSoon: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { recurringObligation: { findMany: vi.fn() } } }));

describe("GET /api/subscriptions compatibility adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.recurringObligation.findMany).mockResolvedValue([{
      id: "obligation-1",
      displayName: "Example plan",
      merchantCanonicalId: "example.test",
      currency: "USD",
      cadence: { type: "MONTHLY", dayOfMonth: 1 },
      schedule: [{ from: "2026-06-01", amountMinor: 2_000 }],
      status: "LAPSED",
      nextExpectedDate: new Date("2026-07-01T00:00:00.000Z"),
      lastObservedAt: new Date("2026-06-01T00:00:00.000Z"),
      notes: null,
      cancellationUrl: null,
      cancelInstructions: null,
      legacySubscription: null,
      ownerFacts: [],
    }] as never);
  });

  it("reads canonical rows directly and carries accurate lifecycle beside the lossy field", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Link")).toContain("/api/recurring");
    expect(body.subscriptions).toEqual([expect.objectContaining({
      id: "obligation-1",
      canonicalId: "obligation-1",
      status: "ACTIVE",
      lifecycleStatus: "LAPSED",
    })]);
    expect(prisma.recurringObligation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", kind: "SUBSCRIPTION" },
    }));
  });

  it("adds deprecation headers to errors too", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("Deprecation")).toBe("true");
  });
});
