import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { deleteExpiredWalletDiagnostics } from "@/lib/domain/wallet/diagnostics";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

vi.mock("@/lib/prisma", () => ({
  prisma: { communityMerchantMCCObservation: { deleteMany: vi.fn() } },
}));
vi.mock("@/lib/domain/wallet/diagnostics", () => ({ deleteExpiredWalletDiagnostics: vi.fn() }));
vi.mock("@/lib/security/cronAuth", () => ({ isAuthorizedCronRequest: vi.fn() }));
vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

function request(): never {
  return new Request("https://example.test/api/cron/retention-sweep", { method: "POST" }) as never;
}

describe("retention sweep cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T04:15:00.000Z"));
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(true);
    vi.mocked(deleteExpiredWalletDiagnostics).mockResolvedValue({ count: 3 } as never);
    vi.mocked(prisma.communityMerchantMCCObservation.deleteMany).mockResolvedValue({ count: 7 });
  });

  it("sweeps every retention domain and reports each count", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deleted: { "wallet-diagnostics": 3, "community-merchant-mcc": 7 },
    });
  });

  it("deletes only community MCC rows outside the 180-day evidence window", async () => {
    await POST(request());

    expect(prisma.communityMerchantMCCObservation.deleteMany).toHaveBeenCalledWith({
      where: { observedAt: { lt: new Date("2026-03-08T04:15:00.000Z") } },
    });
  });

  it("still sweeps later domains when an earlier one fails", async () => {
    vi.mocked(deleteExpiredWalletDiagnostics).mockRejectedValue(new Error("database unavailable"));

    const response = await POST(request());

    expect(prisma.communityMerchantMCCObservation.deleteMany).toHaveBeenCalledOnce();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      deleted: { "community-merchant-mcc": 7 },
      failed: ["wallet-diagnostics"],
    });
  });

  it("fails loudly per domain so QStash retries and operators are alerted", async () => {
    vi.mocked(prisma.communityMerchantMCCObservation.deleteMany).mockRejectedValue(new Error("database unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(sendServiceFailureAlert).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: "cron/retention-sweep:community-merchant-mcc",
    }));
  });

  it("refuses unauthenticated cleanup requests", async () => {
    vi.mocked(isAuthorizedCronRequest).mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(deleteExpiredWalletDiagnostics).not.toHaveBeenCalled();
    expect(prisma.communityMerchantMCCObservation.deleteMany).not.toHaveBeenCalled();
  });
});
