import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { recordLegacySubscriptionAdapterRequest } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/domain/recurring/ownerFacts", () => ({ updateOwnerObligation: vi.fn() }));
vi.mock("@/lib/domain/notifications/eventNotificationScheduler", () => ({ scheduleRecurringObligationRenewalSoon: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordLegacySubscriptionAdapterRequest: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { recurringObligation: { findFirst: vi.fn() } } }));

describe("GET /api/subscriptions/[id] compatibility adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.recurringObligation.findFirst).mockResolvedValue({
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
    } as never);
  });

  it("returns deprecation headers and the accurate lifecycle status", async () => {
    const request = new Request("http://localhost/api/subscriptions/obligation-1");
    const response = await GET(request as never, { params: Promise.resolve({ id: "obligation-1" }) });
    const body = await response.json();

    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Link")).toContain("/api/recurring");
    expect(body.subscription).toMatchObject({
      id: "obligation-1",
      canonicalId: "obligation-1",
      status: "ACTIVE",
      lifecycleStatus: "LAPSED",
    });
    expect(recordLegacySubscriptionAdapterRequest).toHaveBeenCalledWith({
      request,
      route: "item",
      method: "GET",
    });
  });
});
