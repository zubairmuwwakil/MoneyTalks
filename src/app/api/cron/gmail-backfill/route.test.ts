import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST, maxDuration } from "./route";
import { runBackfillChunk } from "@/lib/domain/receipts/gmailBackfill";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

vi.mock("@/lib/security/cronAuth", () => ({ isAuthorizedCronRequest: vi.fn() }));
vi.mock("@/lib/domain/receipts/gmailBackfill", () => ({ runBackfillChunk: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    emailConnection: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

function request() {
  return new Request("http://localhost/api/cron/gmail-backfill");
}

function queueClaims(...connectionIds: string[]) {
  for (const id of connectionIds) {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id }] as never);
  }
  vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);
}

describe("/api/cron/gmail-backfill", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(true);
    vi.mocked(prisma.emailConnection.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(runBackfillChunk).mockResolvedValue({
      processed: 3,
      imported: 2,
      windowFrom: "2026-07-31",
      windowTo: "2026-08-30",
      done: false,
    });
    vi.mocked(sendServiceFailureAlert).mockResolvedValue(undefined);
  });

  it("rejects an unauthenticated request using the shared cron contract", async () => {
    vi.mocked(isAuthorizedCronRequest).mockResolvedValue(false);

    const response = await GET(request() as never);

    expect(response.status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("atomically claims only consented, incomplete, currently unlocked connections", async () => {
    queueClaims("conn-requested");

    const response = await GET(request() as never);
    const body = await response.json();

    expect(body.connections.map((connection: { connectionId: string }) => connection.connectionId))
      .toEqual(["conn-requested"]);
    const sql = (vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as unknown as readonly string[]).join(" ");
    expect(sql).toContain('"backfillRequestedAt" IS NOT NULL');
    expect(sql).toContain('"backfillCompletedAt" IS NULL');
    expect(sql).toContain('"backfillLockedAt" IS NULL');
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain('SET "backfillLockedAt" = NOW()');
  });

  it("releases its lease after a successful chunk", async () => {
    queueClaims("conn-requested");

    await GET(request() as never);

    expect(prisma.emailConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "conn-requested", backfillLockId: expect.any(String) },
      data: { backfillLockedAt: null, backfillLockId: null, lastScanError: null },
    });
  });

  it("records a failure, releases the lease, and keeps going", async () => {
    queueClaims("conn-broken", "conn-healthy");
    vi.mocked(runBackfillChunk)
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockResolvedValueOnce({
        processed: 1,
        imported: 1,
        windowFrom: "2026-07-31",
        windowTo: "2026-08-30",
        done: true,
      });

    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, claimed: 2, advanced: 1, failed: 1 });
    expect(body.connections).toContainEqual({ connectionId: "conn-broken", error: "invalid_grant" });
    expect(body.connections).toContainEqual(expect.objectContaining({ connectionId: "conn-healthy", done: true }));
    expect(prisma.emailConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "conn-broken", backfillLockId: expect.any(String) },
      data: {
        backfillLockedAt: null,
        backfillLockId: null,
        lastScanError: "invalid_grant",
      },
    });
    expect(sendServiceFailureAlert).toHaveBeenCalledOnce();
  });

  it("caps each invocation and exposes the 120-second route duration", async () => {
    queueClaims("conn-1", "conn-2", "conn-3", "conn-4", "conn-5");

    const response = await POST(request() as never);
    const body = await response.json();

    expect(maxDuration).toBe(120);
    expect(body).toMatchObject({ claimed: 4, advanced: 4, failed: 0 });
    expect(runBackfillChunk).toHaveBeenCalledTimes(4);
  });

  it("stops claiming new work with headroom before maxDuration", async () => {
    queueClaims("conn-1", "conn-2");
    const clock = vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(106_000);

    const response = await GET(request() as never);
    const body = await response.json();

    expect(body).toMatchObject({ claimed: 1, advanced: 1 });
    expect(runBackfillChunk).toHaveBeenCalledOnce();
    clock.mockRestore();
  });
});
