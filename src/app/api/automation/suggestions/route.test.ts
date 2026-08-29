import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationSuggestion: { findFirst: vi.fn(), update: vi.fn() },
    subscription: { create: vi.fn() },
  },
}));
vi.mock("@/lib/domain/notifications/eventNotificationScheduler", () => ({
  scheduleBillDueSoon: vi.fn(),
  scheduleReturnDeadlineSoon: vi.fn(),
  scheduleReturnDelivered: vi.fn(),
  scheduleSubscriptionRenewalSoon: vi.fn(),
}));
vi.mock("@/lib/domain/shipping/tracking", () => ({
  refreshShipmentTimeline: vi.fn(),
  syncRefundExpectation: vi.fn(),
}));
vi.mock("@/engine/returns/transitions", () => ({ canTransition: vi.fn() }));

function request(body: unknown) {
  return new Request("http://localhost/api/automation/suggestions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/automation/suggestions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.automationSuggestion.findFirst).mockResolvedValue({
      id: "suggestion-1",
      userId: "user-1",
      type: "SUBSCRIPTION",
      status: "NEW",
      merchant: "Example Merchant",
      amountCents: 1649,
      currency: "CAD",
      draft: {},
    } as never);
  });

  it("rejects accepting a subscription without a renewal date", async () => {
    const response = await POST(request({
      id: "suggestion-1",
      action: "CONFIRM",
      draft: { merchant: "Example Merchant", type: "SUBSCRIPTION", currency: "CAD", cadence: "MONTHLY" },
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Subscription requires draft.renewalDate (YYYY-MM-DD)",
    });
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(prisma.automationSuggestion.update).not.toHaveBeenCalled();
  });
});
