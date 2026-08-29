import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { getAuthedGmail } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRecentRawGmailMessages } from "@/lib/services/gmailScanSource";
import { processRawGmailMessage } from "@/lib/domain/receipts/gmailReceiptProcessing";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailTransaction: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/services/gmailClient", () => ({ getAuthedGmail: vi.fn() }));
vi.mock("@/lib/services/gmailScanSource", () => ({
  hasGmailReadScope: vi.fn(),
  listRecentRawGmailMessages: vi.fn(),
}));
vi.mock("@/lib/domain/receipts/gmailReceiptProcessing", () => ({ processRawGmailMessage: vi.fn() }));

function request(body?: unknown) {
  return new Request("http://localhost/api/automation/reprocess", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const flushTokens = vi.fn();
const gmail = { users: { messages: {} } };

function transaction(messageId: string) {
  return { id: `tx-${messageId}`, messageId };
}

function rawMessage(messageId: string) {
  return {
    messageId,
    raw: Buffer.from("raw MIME"),
    subject: "Receipt",
    from: "orders@example.com",
    internalDate: new Date("2026-08-01T00:00:00.000Z"),
    rfc822MessageId: null,
  };
}

describe("POST /api/automation/reprocess", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(getAuthedGmail).mockResolvedValue({
      gmail,
      conn: { scope: "https://www.googleapis.com/auth/gmail.readonly" },
      flushTokens,
    } as never);
    vi.mocked(hasGmailReadScope).mockReturnValue(true);
    vi.mocked(prisma.emailTransaction.count).mockResolvedValue(0);
    vi.mocked(prisma.emailTransaction.findMany).mockResolvedValue([]);
  });

  it("requires a signed-in user", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);

    const response = await POST(request() as never);

    expect(response.status).toBe(401);
    expect(getAuthedGmail).not.toHaveBeenCalled();
  });

  it("requires a Gmail read grant", async () => {
    vi.mocked(hasGmailReadScope).mockReturnValue(false);

    const response = await POST(request() as never);

    expect(response.status).toBe(400);
    expect(prisma.emailTransaction.findMany).not.toHaveBeenCalled();
  });

  it("re-fetches only the caller's stored Gmail rows and reports batch progress", async () => {
    vi.mocked(prisma.emailTransaction.count).mockResolvedValue(3);
    vi.mocked(prisma.emailTransaction.findMany).mockResolvedValue([
      transaction("gmail-1"),
      transaction("gmail-2"),
    ] as never);
    vi.mocked(listRecentRawGmailMessages)
      .mockResolvedValueOnce([rawMessage("gmail-1")])
      .mockResolvedValueOnce([rawMessage("gmail-2")]);
    vi.mocked(processRawGmailMessage)
      .mockResolvedValueOnce({ parserError: null, purchaseAction: "created" } as never)
      .mockResolvedValueOnce({ parserError: null, purchaseAction: "deleted" } as never);

    const response = await POST(request({ batchSize: 2, offset: 0 }) as never);

    expect(prisma.emailTransaction.count).toHaveBeenCalledWith({
      where: { userId: "user-1", provider: "GMAIL" },
    });
    expect(prisma.emailTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", provider: "GMAIL" },
      skip: 0,
      take: 2,
      select: { id: true, messageId: true },
    }));
    expect(listRecentRawGmailMessages).toHaveBeenNthCalledWith(1, gmail, { messageIds: ["gmail-1"] });
    expect(listRecentRawGmailMessages).toHaveBeenNthCalledWith(2, gmail, { messageIds: ["gmail-2"] });
    expect(processRawGmailMessage).toHaveBeenNthCalledWith(1, prisma, {
      userId: "user-1",
      message: expect.objectContaining({ messageId: "gmail-1" }),
      mode: "reprocess",
    });
    expect(await response.json()).toEqual({
      ok: true,
      totalCount: 3,
      processed: 2,
      succeeded: 2,
      failed: 0,
      offset: 0,
      batchSize: 2,
      hasMore: true,
      nextOffset: 2,
      errors: [],
      progress: 67,
      purchasesCreated: 1,
      purchasesUpdated: 0,
      purchasesLinked: 0,
      purchasesDeleted: 1,
      purchasesUnlinked: 0,
    });
    expect(flushTokens).toHaveBeenCalledOnce();
  });

  it("continues the batch when a stored Gmail message is gone", async () => {
    vi.mocked(prisma.emailTransaction.count).mockResolvedValue(2);
    vi.mocked(prisma.emailTransaction.findMany).mockResolvedValue([
      transaction("gone"),
      transaction("gmail-2"),
    ] as never);
    vi.mocked(listRecentRawGmailMessages)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([rawMessage("gmail-2")]);
    vi.mocked(processRawGmailMessage).mockResolvedValue({
      parserError: null,
      purchaseAction: "unlinked",
    } as never);

    const response = await POST(request({ batchSize: 2 }) as never);
    const json = await response.json();

    expect(json).toMatchObject({ processed: 2, succeeded: 1, failed: 1, hasMore: false });
    expect(json.errors).toEqual([{ messageId: "gone", error: "Raw Gmail message not found" }]);
    expect(processRawGmailMessage).toHaveBeenCalledOnce();
    expect(flushTokens).toHaveBeenCalledOnce();
  });

  it("counts parser failures without losing the rest of the batch", async () => {
    vi.mocked(prisma.emailTransaction.count).mockResolvedValue(1);
    vi.mocked(prisma.emailTransaction.findMany).mockResolvedValue([transaction("gmail-1")] as never);
    vi.mocked(listRecentRawGmailMessages).mockResolvedValue([rawMessage("gmail-1")]);
    vi.mocked(processRawGmailMessage).mockResolvedValue({
      parserError: "malformed MIME",
      purchaseAction: "none",
    } as never);

    const response = await POST(request() as never);
    const json = await response.json();

    expect(json).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    expect(json.errors).toEqual([{ messageId: "gmail-1", error: "malformed MIME" }]);
    expect(flushTokens).toHaveBeenCalledOnce();
  });
});
