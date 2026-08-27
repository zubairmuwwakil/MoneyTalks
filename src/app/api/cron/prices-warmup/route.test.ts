import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { warmQuoteCache } from "@/lib/domain/investments/warmQuoteCache";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

vi.mock("@/lib/security/cronAuth", () => ({
  isAuthorizedCronRequest: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/domain/investments/warmQuoteCache", () => ({ warmQuoteCache: vi.fn() }));

vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

function request(): never {
  return new Request("https://example.test/api/cron/prices-warmup", { method: "POST" }) as never;
}

/**
 * This job's only reason to exist is that the expensive work must happen where
 * failure is affordable and visible. A warm-up that pings a health endpoint and
 * calls itself successful is worse than none: it reports green while leaving the
 * provider fan-out — the actual slow path — stone cold for the price cron to pay
 * for under a deadline.
 */
describe("prices-warmup cron", () => {
  beforeEach(() => vi.clearAllMocks());

  it("warms MarketLens' provider path rather than only waking its HTTP layer", async () => {
    vi.mocked(warmQuoteCache).mockResolvedValue({
      ok: true, symbols: 4, fresh: 4, stale: 0, causes: {},
    });

    const response = await POST(request());

    expect(warmQuoteCache).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, fresh: 4 });
  });

  it("alerts and fails loudly when the sweep warmed nothing", async () => {
    vi.mocked(warmQuoteCache).mockResolvedValue({
      ok: false, symbols: 4, fresh: 0, stale: 4,
      causes: { provider_deadline_exceeded: 4 },
    });

    const response = await POST(request());

    // 502 so QStash retries and the failure is a failed HTTP call, not a log line.
    expect(response.status).toBe(502);
    expect(sendServiceFailureAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendServiceFailureAlert).mock.calls[0][0]).toMatchObject({
      serviceName: "cron/prices-warmup",
    });
  });

  it("refuses an unauthorized request", async () => {
    const { isAuthorizedCronRequest } = await import("@/lib/security/cronAuth");
    vi.mocked(isAuthorizedCronRequest).mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(warmQuoteCache).not.toHaveBeenCalled();
  });
});
