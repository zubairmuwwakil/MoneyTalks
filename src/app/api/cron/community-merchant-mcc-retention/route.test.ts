import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

vi.mock("@/lib/prisma", () => ({
  prisma: { communityMerchantMCCObservation: { deleteMany: vi.fn() } },
}));
vi.mock("@/lib/security/cronAuth", () => ({ isAuthorizedCronRequest: vi.fn() }));
vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

function request(): never {
  return new Request("https://example.test/api/cron/community-merchant-mcc-retention", { method: "POST" }) as never;
}

describe("community merchant MCC retention cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T04:30:00.000Z"));
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(true);
  });

  it("deletes only rows outside the 180-day evidence window", async () => {
    vi.mocked(prisma.communityMerchantMCCObservation.deleteMany).mockResolvedValue({ count: 7 });

    const response = await POST(request());

    expect(prisma.communityMerchantMCCObservation.deleteMany).toHaveBeenCalledWith({
      where: { observedAt: { lt: new Date("2026-03-08T04:30:00.000Z") } },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: 7 });
  });

  it("fails loudly so QStash retries and operators are alerted", async () => {
    vi.mocked(prisma.communityMerchantMCCObservation.deleteMany).mockRejectedValue(new Error("database unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(sendServiceFailureAlert).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: "cron/community-merchant-mcc-retention",
    }));
  });

  it("refuses unauthenticated cleanup requests", async () => {
    vi.mocked(isAuthorizedCronRequest).mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(prisma.communityMerchantMCCObservation.deleteMany).not.toHaveBeenCalled();
  });
});
