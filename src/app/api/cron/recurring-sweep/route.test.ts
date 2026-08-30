import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, maxDuration } from "./route";
import { sweepRecurringObligations } from "@/lib/domain/recurring/detectRecurring";
import {
  claimRecurringSweepJobs,
  completeRecurringSweepJob,
  enqueueRecurringSweepJobs,
  failRecurringSweepJob,
} from "@/lib/domain/recurring/sweepQueue";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

vi.mock("@/lib/security/cronAuth", () => ({ isAuthorizedCronRequest: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { notificationPreference: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/domain/recurring/detectRecurring", () => ({ sweepRecurringObligations: vi.fn() }));
vi.mock("@/lib/domain/recurring/sweepQueue", () => ({
  claimRecurringSweepJobs: vi.fn(),
  completeRecurringSweepJob: vi.fn(),
  enqueueRecurringSweepJobs: vi.fn(),
  failRecurringSweepJob: vi.fn(),
}));
vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

function request() {
  return new Request("http://localhost/api/cron/recurring-sweep");
}

describe("GET /api/cron/recurring-sweep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(true);
    vi.mocked(enqueueRecurringSweepJobs).mockResolvedValue(0);
    vi.mocked(claimRecurringSweepJobs).mockResolvedValue({
      lockId: "lease-1",
      jobs: [
        { userId: "user-1", attempts: 1 },
        { userId: "user-2", attempts: 1 },
      ],
    });
    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue({ timezone: "America/Toronto" } as never);
    vi.mocked(sweepRecurringObligations).mockResolvedValue({ created: 0, updated: 0, unchanged: 0, skipped: 0 });
    vi.mocked(completeRecurringSweepJob).mockResolvedValue(undefined);
    vi.mocked(failRecurringSweepJob).mockResolvedValue(undefined);
    vi.mocked(sendServiceFailureAlert).mockResolvedValue(undefined);
  });

  it("rejects an unauthenticated request using the shared cron contract", async () => {
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(false);

    const response = await GET(request() as never);

    expect(response.status).toBe(403);
    expect(claimRecurringSweepJobs).not.toHaveBeenCalled();
  });

  it("caps the owner batch below the route duration limit", async () => {
    await GET(request() as never);

    expect(maxDuration).toBe(120);
    expect(claimRecurringSweepJobs).toHaveBeenCalledWith(prisma, 8);
  });

  it("sweeps each owner and keeps going when one fails", async () => {
    vi.mocked(sweepRecurringObligations).mockRejectedValueOnce(new Error("boom"));

    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, claimed: 2, swept: 1, failed: 1 });
    expect(failRecurringSweepJob).toHaveBeenCalledWith(prisma, expect.objectContaining({
      userId: "user-1",
      error: "boom",
    }));
    expect(completeRecurringSweepJob).toHaveBeenCalledWith(prisma, {
      userId: "user-2",
      lockId: "lease-1",
    });
    expect(sendServiceFailureAlert).toHaveBeenCalledOnce();
  });
});
