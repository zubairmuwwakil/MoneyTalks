import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { enqueueCronContinuation } from "@/lib/services/qstashContinuation";

vi.mock("@/lib/security/cronAuth", () => ({
  isAuthorizedCronRequest: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/domain/wallet/walletNormalization", () => ({
  processWalletEvents: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/domain/shipping/tracking", () => ({
  refreshShipmentTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/domain/notifications/eventNotificationScheduler", () => ({
  scheduleSubscriptionRenewalSoon: vi.fn().mockResolvedValue(undefined),
  scheduleReturnDeadlineSoon: vi.fn().mockResolvedValue(undefined),
  scheduleRefundChecks: vi.fn().mockResolvedValue(undefined),
  scheduleRefundOverdueOnce: vi.fn().mockResolvedValue(undefined),
  scheduleCardFeeDecisionSoon: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

vi.mock("@/lib/services/qstashContinuation", () => ({
  enqueueCronContinuation: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    returnItem: { findMany: vi.fn() },
    subscription: { findMany: vi.fn() },
    creditCard: { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
    refundCase: { upsert: vi.fn() },
  },
}));

function request(body?: unknown): never {
  return new Request("https://example.test/api/cron/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

describe("notification cron pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.returnItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([] as never);
    vi.mocked(enqueueCronContinuation).mockResolvedValue({ queued: true, messageId: "msg-1" });
  });

  it("bounds every query and does not enqueue when all streams fit", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(enqueueCronContinuation).not.toHaveBeenCalled();
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { id: "asc" },
      take: 50,
    }));
    expect(prisma.creditCard.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { id: "asc" },
      take: 50,
    }));
  });

  it("continues a full page with a signed, deduplicated cursor job", async () => {
    const trackable = Array.from({ length: 50 }, (_, index) => ({ id: `track-${index}`, userId: "user-1" }));
    const returns = Array.from({ length: 50 }, (_, index) => ({
      id: `return-${index}`,
      userId: "user-1",
      store: "Store",
      itemNote: null,
      amountCents: null,
      currency: "CAD",
      returnBy: new Date("2026-09-01T00:00:00.000Z"),
      status: "NOT_STARTED",
    }));
    vi.mocked(prisma.returnItem.findMany)
      .mockResolvedValueOnce(trackable as never)
      .mockResolvedValueOnce(returns as never)
      .mockResolvedValueOnce([] as never);

    const response = await GET(request({ source: "qstash", job: "notify", runId: "run-1" }));

    expect(response.status).toBe(200);
    expect(enqueueCronContinuation).toHaveBeenCalledWith({
      path: "/api/cron/notify",
      body: {
        source: "qstash",
        job: "notify",
        runId: "run-1",
        trackableCursor: "track-49",
        subscriptionCursor: null,
        returnCursor: "return-49",
        refundCursor: null,
        cardCursor: null,
      },
      deduplicationId: expect.stringContaining("notify:run-1:"),
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      attempted: 50,
      polled: 50,
      continuation: { queued: true, messageId: "msg-1" },
    });
  });
});
