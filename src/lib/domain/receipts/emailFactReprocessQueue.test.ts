import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  EMAIL_FACT_PROJECTION_VERSION,
  claimNextEmailFactReprocessJob,
  completeEmailFactReprocessChunk,
  failEmailFactReprocessJob,
} from "./emailFactReprocessQueue";

describe("email fact reprocess queue", () => {
  it("completes an owner only after its final transaction chunk", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { emailFactReprocessJob: { updateMany } } as unknown as PrismaClient;

    await completeEmailFactReprocessChunk(db, {
      userId: "user-fictional",
      lockId: "lease-fictional",
      targetVersion: "cancellation:2",
      hasMore: false,
      cursor: {
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        id: "tx-fictional",
      },
      completedAt: new Date("2026-08-31T04:00:00.000Z"),
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-fictional",
        status: "RUNNING",
        lockId: "lease-fictional",
        targetVersion: "cancellation:2",
      },
      data: {
        status: "COMPLETE",
        completedVersion: "cancellation:2",
        completedAt: new Date("2026-08-31T04:00:00.000Z"),
        cursorCreatedAt: null,
        cursorId: null,
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockId: null,
      },
    });
  });

  it("builds the campaign watermark from independent extractor versions", () => {
    expect(EMAIL_FACT_PROJECTION_VERSION).toContain("cancellation:2");
    expect(EMAIL_FACT_PROJECTION_VERSION).toContain("price-change:2");
  });

  it("claims one owner atomically with a recoverable lease", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const db = { $queryRaw: queryRaw } as unknown as PrismaClient;

    await claimNextEmailFactReprocessJob(db);

    const sql = (queryRaw.mock.calls[0]?.[0] as unknown as readonly string[]).join(" ");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("LIMIT 1");
    expect(sql).toContain("INTERVAL '10 minutes'");
    expect(sql).toContain("SET status = 'RUNNING'");
  });

  it("backs failed owners off and releases their lease", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { emailFactReprocessJob: { updateMany } } as unknown as PrismaClient;
    const failedAt = new Date("2026-08-31T04:00:00.000Z");

    await failEmailFactReprocessJob(db, {
      userId: "user-fictional",
      lockId: "lease-fictional",
      attempts: 2,
      error: "fictional failure",
      failedAt,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-fictional", status: "RUNNING", lockId: "lease-fictional" },
      data: expect.objectContaining({
        status: "PENDING",
        runAt: new Date("2026-08-31T04:30:00.000Z"),
        lastError: "fictional failure",
        lockedAt: null,
        lockId: null,
      }),
    }));
  });
});
