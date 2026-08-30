import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  completeRecurringSweepJob,
  failRecurringSweepJob,
  nextRecurringSweepRetryAt,
} from "./sweepQueue";

function dbWithUpdateCount(count = 1) {
  return {
    recurringSweepJob: { updateMany: vi.fn().mockResolvedValue({ count }) },
  } as unknown as PrismaClient;
}

describe("recurring sweep queue", () => {
  it("reschedules a completed owner and records the durable sweep marker", async () => {
    const db = dbWithUpdateCount();
    const completedAt = new Date("2026-08-29T04:00:00.000Z");

    await completeRecurringSweepJob(db, { userId: "user-1", lockId: "lease-1", completedAt });

    expect(db.recurringSweepJob.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "RUNNING", lockId: "lease-1" },
      data: expect.objectContaining({
        status: "PENDING",
        runAt: new Date("2026-08-30T04:00:00.000Z"),
        lastSweptAt: completedAt,
        attempts: 0,
      }),
    });
  });

  it("backs failed owners off without losing the job", async () => {
    const db = dbWithUpdateCount();
    const failedAt = new Date("2026-08-29T04:00:00.000Z");

    await failRecurringSweepJob(db, {
      userId: "user-1",
      lockId: "lease-1",
      attempts: 2,
      error: "boom",
      failedAt,
    });

    expect(db.recurringSweepJob.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "RUNNING", lockId: "lease-1" },
      data: expect.objectContaining({
        status: "PENDING",
        runAt: new Date("2026-08-29T04:30:00.000Z"),
        lastError: "boom",
      }),
    });
  });

  it("caps retry delay at one day", () => {
    const now = new Date("2026-08-29T04:00:00.000Z");
    expect(nextRecurringSweepRetryAt(now, 99)).toEqual(new Date("2026-08-30T04:00:00.000Z"));
  });

  it("rejects completion after the lease was lost", async () => {
    await expect(completeRecurringSweepJob(dbWithUpdateCount(0), {
      userId: "user-1",
      lockId: "stale-lease",
    })).rejects.toThrow("lease lost");
  });
});
