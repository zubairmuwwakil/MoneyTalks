import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST, maxDuration } from "./route";
import {
  claimNextEmailFactReprocessJob,
  completeEmailFactReprocessChunk,
  countPendingEmailFactReprocessJobs,
  enqueueEmailFactReprocessJobs,
  failEmailFactReprocessJob,
} from "@/lib/domain/receipts/emailFactReprocessQueue";
import { reprocessStoredGmailMessages } from "@/lib/domain/receipts/gmailReprocessing";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";
import {
  enqueueCronContinuation,
  isQstashContinuationConfigured,
} from "@/lib/services/qstashContinuation";

vi.mock("@/lib/security/cronAuth", () => ({ isAuthorizedCronRequest: vi.fn() }));
vi.mock("@/lib/domain/receipts/emailFactReprocessQueue", () => ({
  claimNextEmailFactReprocessJob: vi.fn(),
  completeEmailFactReprocessChunk: vi.fn(),
  countPendingEmailFactReprocessJobs: vi.fn(),
  enqueueEmailFactReprocessJobs: vi.fn(),
  failEmailFactReprocessJob: vi.fn(),
}));
vi.mock("@/lib/domain/receipts/gmailReprocessing", () => ({ reprocessStoredGmailMessages: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { emailTransaction: { findMany: vi.fn() } } }));
vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));
vi.mock("@/lib/services/qstashContinuation", () => ({
  enqueueCronContinuation: vi.fn(),
  isQstashContinuationConfigured: vi.fn(),
}));

describe("/api/cron/email-fact-reprocess", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(true);
    vi.mocked(enqueueEmailFactReprocessJobs).mockResolvedValue(1);
    vi.mocked(claimNextEmailFactReprocessJob).mockResolvedValue(null);
    vi.mocked(completeEmailFactReprocessChunk).mockResolvedValue(undefined);
    vi.mocked(failEmailFactReprocessJob).mockResolvedValue(undefined);
    vi.mocked(countPendingEmailFactReprocessJobs).mockResolvedValue(0);
    vi.mocked(prisma.emailTransaction.findMany).mockResolvedValue([]);
    vi.mocked(reprocessStoredGmailMessages).mockResolvedValue({
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      purchaseActions: { none: 0, created: 0, updated: 0, linked: 0, deleted: 0, unlinked: 0 },
    });
    vi.mocked(sendServiceFailureAlert).mockResolvedValue(undefined);
    vi.mocked(isQstashContinuationConfigured).mockReturnValue(false);
    vi.mocked(enqueueCronContinuation).mockResolvedValue({ queued: true, messageId: "continuation-fictional" });
  });

  it("rejects an unauthenticated request before claiming owner work", async () => {
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(false);

    const response = await GET(new Request("http://localhost/api/cron/email-fact-reprocess") as never);

    expect(response.status).toBe(403);
    expect(claimNextEmailFactReprocessJob).not.toHaveBeenCalled();
  });

  it("replays a bounded owner chunk in fact-only mode", async () => {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    vi.mocked(claimNextEmailFactReprocessJob)
      .mockResolvedValueOnce({
        lockId: "lease-fictional",
        job: {
          userId: "user-fictional",
          targetVersion: "cancellation:2",
          attempts: 1,
          cursorCreatedAt: null,
          cursorId: null,
        },
      })
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.emailTransaction.findMany).mockResolvedValue([{
      id: "tx-fictional",
      messageId: "message-fictional",
      connectionId: "conn-fictional",
      createdAt,
    }] as never);
    vi.mocked(reprocessStoredGmailMessages).mockResolvedValue({
      processed: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
      purchaseActions: { none: 1, created: 0, updated: 0, linked: 0, deleted: 0, unlinked: 0 },
    });

    const response = await POST(new Request("http://localhost/api/cron/email-fact-reprocess", {
      method: "POST",
    }) as never);
    const body = await response.json();

    expect(maxDuration).toBe(120);
    expect(prisma.emailTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-fictional", provider: "GMAIL" },
      take: 26,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }));
    expect(reprocessStoredGmailMessages).toHaveBeenCalledWith(prisma, {
      userId: "user-fictional",
      transactions: [expect.objectContaining({ id: "tx-fictional" })],
      mode: "facts-reprocess",
    });
    expect(completeEmailFactReprocessChunk).toHaveBeenCalledWith(prisma, {
      userId: "user-fictional",
      lockId: "lease-fictional",
      targetVersion: "cancellation:2",
      hasMore: false,
      cursor: { createdAt, id: "tx-fictional" },
    });
    expect(body).toMatchObject({
      ok: true,
      enqueued: 1,
      claimed: 1,
      advanced: 1,
      completed: 1,
      processed: 1,
      succeeded: 1,
      messageFailures: 0,
    });
  });

  it("queues a continuation only when QStash continuation is configured", async () => {
    vi.mocked(claimNextEmailFactReprocessJob)
      .mockResolvedValueOnce({
        lockId: "lease-fictional",
        job: {
          userId: "user-fictional",
          targetVersion: "cancellation:2",
          attempts: 1,
          cursorCreatedAt: null,
          cursorId: null,
        },
      })
      .mockResolvedValueOnce(null);
    vi.mocked(countPendingEmailFactReprocessJobs).mockResolvedValue(1);
    vi.mocked(isQstashContinuationConfigured).mockReturnValue(true);

    const response = await GET(new Request("http://localhost/api/cron/email-fact-reprocess") as never);

    expect(enqueueCronContinuation).toHaveBeenCalledWith({
      path: "/api/cron/email-fact-reprocess",
      body: { source: "qstash", job: "email-fact-reprocess" },
      deduplicationId: expect.stringContaining("email-fact-reprocess-cont:"),
    });
    expect(await response.json()).toMatchObject({
      continuation: { queued: true, messageId: "continuation-fictional" },
    });
  });

  it("degrades to one bounded invocation when continuation is not configured", async () => {
    vi.mocked(claimNextEmailFactReprocessJob)
      .mockResolvedValueOnce({
        lockId: "lease-fictional",
        job: {
          userId: "user-fictional",
          targetVersion: "cancellation:2",
          attempts: 1,
          cursorCreatedAt: null,
          cursorId: null,
        },
      })
      .mockResolvedValueOnce(null);
    vi.mocked(countPendingEmailFactReprocessJobs).mockResolvedValue(1);
    vi.mocked(isQstashContinuationConfigured).mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/cron/email-fact-reprocess") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, advanced: 1, remaining: 1 });
    expect(body.continuation).toBeUndefined();
    expect(enqueueCronContinuation).not.toHaveBeenCalled();
  });

  it("alerts on per-message failures while advancing the durable cursor", async () => {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    vi.mocked(claimNextEmailFactReprocessJob)
      .mockResolvedValueOnce({
        lockId: "lease-fictional",
        job: {
          userId: "user-fictional",
          targetVersion: "cancellation:2",
          attempts: 1,
          cursorCreatedAt: null,
          cursorId: null,
        },
      })
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.emailTransaction.findMany).mockResolvedValue([{
      id: "tx-fictional",
      messageId: "message-fictional",
      connectionId: "conn-fictional",
      createdAt,
    }] as never);
    vi.mocked(reprocessStoredGmailMessages).mockResolvedValue({
      processed: 1,
      succeeded: 0,
      failed: 1,
      errors: [{ messageId: "message-fictional", error: "Raw Gmail message not found" }],
      purchaseActions: { none: 0, created: 0, updated: 0, linked: 0, deleted: 0, unlinked: 0 },
    });

    const response = await GET(new Request("http://localhost/api/cron/email-fact-reprocess") as never);
    const body = await response.json();

    expect(body).toMatchObject({ advanced: 1, completed: 1, messageFailures: 1 });
    expect(completeEmailFactReprocessChunk).toHaveBeenCalledOnce();
    expect(failEmailFactReprocessJob).not.toHaveBeenCalled();
    expect(sendServiceFailureAlert).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: "cron/email-fact-reprocess",
    }));
  });

  it("stops claiming owners with headroom before maxDuration", async () => {
    vi.mocked(claimNextEmailFactReprocessJob).mockResolvedValue({
      lockId: "lease-fictional",
      job: {
        userId: "user-fictional",
        targetVersion: "cancellation:2",
        attempts: 1,
        cursorCreatedAt: null,
        cursorId: null,
      },
    });
    const clock = vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(106_000);

    const response = await GET(new Request("http://localhost/api/cron/email-fact-reprocess") as never);
    const body = await response.json();

    expect(body).toMatchObject({ claimed: 1, advanced: 1 });
    expect(claimNextEmailFactReprocessJob).toHaveBeenCalledOnce();
    clock.mockRestore();
  });
});
