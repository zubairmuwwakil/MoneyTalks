import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { enqueueCronContinuation } from "@/lib/services/qstashContinuation";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/services/qstashContinuation", () => ({
  enqueueCronContinuation: vi.fn().mockResolvedValue({ queued: true, messageId: "msg-1" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailConnection: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

function request(body: unknown) {
  return new Request("http://localhost/api/gmail/backfill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/gmail/backfill", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T15:00:00.000Z"));
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.emailConnection.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.emailConnection.findMany).mockResolvedValue([
      {
        id: "conn-a",
        emailAddress: "owner@example.com",
        backfillRequestedAt: new Date("2026-08-29T00:00:00.000Z"),
        backfillCursor: "2026-02-28",
        backfillCompletedAt: null,
      },
    ] as never);
  });

  afterEach(() => vi.useRealTimers());

  it("records consent for the owner's own connection", async () => {
    const response = await POST(request({ connectionId: "conn-a" }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.emailConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "conn-a", userId: "user-1" },
      data: { backfillRequestedAt: new Date("2026-08-30T15:00:00.000Z") },
    });
    expect(body).toEqual({
      ok: true,
      connectionId: "conn-a",
      requestedAt: "2026-08-30T15:00:00.000Z",
    });
    expect(enqueueCronContinuation).toHaveBeenCalledWith({
      path: "/api/cron/gmail-backfill",
      body: { source: "qstash", job: "gmail-backfill", connectionId: "conn-a" },
      deduplicationId: expect.stringContaining("gmail-backfill-req:conn-a:"),
    });
  });

  it("refuses a connection belonging to someone else", async () => {
    vi.mocked(prisma.emailConnection.updateMany).mockResolvedValue({ count: 0 });

    const response = await POST(request({ connectionId: "someone-elses" }) as never);

    expect(response.status).toBe(404);
    expect(prisma.emailConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "someone-elses", userId: "user-1" },
    }));
  });

  it("reports progress as months covered", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.emailConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", provider: "GMAIL" },
    }));
    expect(body.connections[0]).toMatchObject({
      connectionId: "conn-a",
      monthsCovered: 6,
      monthsTarget: 24,
      complete: false,
    });
  });

  it("reports zero before work starts and the full target after completion", async () => {
    vi.mocked(prisma.emailConnection.findMany).mockResolvedValue([
      {
        id: "conn-new",
        emailAddress: "new@example.com",
        backfillRequestedAt: null,
        backfillCursor: null,
        backfillCompletedAt: null,
      },
      {
        id: "conn-complete",
        emailAddress: "done@example.com",
        backfillRequestedAt: new Date("2026-08-01T00:00:00.000Z"),
        backfillCursor: "2024-08-30",
        backfillCompletedAt: new Date("2026-08-30T14:00:00.000Z"),
      },
    ] as never);

    const body = await (await GET()).json();

    expect(body.connections[0]).toMatchObject({ requestedAt: null, monthsCovered: 0, complete: false });
    expect(body.connections[1]).toMatchObject({ monthsCovered: 24, complete: true });
  });

  it("validates authentication and the connection id", async () => {
    vi.mocked(getSessionUserId).mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(401);

    expect((await POST(request({}) as never)).status).toBe(400);
  });
});
