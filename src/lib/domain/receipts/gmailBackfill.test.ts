import { beforeEach, describe, expect, it, vi } from "vitest";

import { processRawGmailMessage } from "./gmailReceiptProcessing";
import { runBackfillChunk } from "./gmailBackfill";
import { getAuthedGmail } from "@/lib/services/gmailClient";
import { listRawGmailMessagesInWindow, type RawGmailMessage } from "@/lib/services/gmailScanSource";

vi.mock("@/lib/services/gmailClient", () => ({ getAuthedGmail: vi.fn() }));
vi.mock("@/lib/services/gmailScanSource", () => ({
  hasGmailReadScope: vi.fn(() => true),
  listRawGmailMessagesInWindow: vi.fn(),
}));
vi.mock("./gmailReceiptProcessing", () => ({ processRawGmailMessage: vi.fn() }));

const now = new Date("2026-08-30T15:45:00.000Z");
const message: RawGmailMessage = {
  messageId: "gmail-1",
  raw: Buffer.from("Subject: Receipt\r\n\r\nTotal: $10.00"),
  subject: "Receipt",
  from: "shop@example.com",
  internalDate: new Date("2026-08-01T00:00:00.000Z"),
  rfc822MessageId: "receipt-1@example.com",
};

type ConnectionState = {
  id: string;
  userId: string;
  scope: string;
  backfillRequestedAt: Date | null;
  backfillCursor: string | null;
  backfillCompletedAt: Date | null;
  lastScanAt: Date | null;
};

function setup(overrides: Partial<ConnectionState> = {}) {
  const state: ConnectionState = {
    id: "conn-a",
    userId: "user-1",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    backfillRequestedAt: new Date("2026-08-29T00:00:00.000Z"),
    backfillCursor: null,
    backfillCompletedAt: null,
    lastScanAt: null,
    ...overrides,
  };
  const findUnique = vi.fn(async () => ({ ...state }));
  const update = vi.fn(async ({ data }: { data: Partial<ConnectionState> }) => {
    Object.assign(state, data);
    return { ...state };
  });
  const db = { emailConnection: { findUnique, update } };

  return { db, state, findUnique, update };
}

describe("runBackfillChunk", () => {
  const flushTokens = vi.fn(async () => undefined);
  const gmail = { users: { messages: {} } };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedGmail).mockResolvedValue({
      gmail,
      conn: { scope: "https://www.googleapis.com/auth/gmail.readonly" },
      flushTokens,
    } as never);
    vi.mocked(listRawGmailMessagesInWindow).mockResolvedValue([message]);
    vi.mocked(processRawGmailMessage).mockResolvedValue({
      transactionAction: "created",
      purchaseAction: "created",
      parserError: null,
    } as never);
  });

  it("starts at today when no cursor is set", async () => {
    const { db, state } = setup();

    const result = await runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    });

    expect(result).toMatchObject({ windowTo: "2026-08-30", windowFrom: "2026-07-31", done: false });
    expect(state.backfillCursor).toBe("2026-07-31");
  });

  it("resumes from the stored cursor, walking backwards", async () => {
    const { db } = setup({ backfillCursor: "2026-05-01" });

    const result = await runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    });

    expect(result.windowTo).toBe("2026-05-01");
    expect(result.windowFrom).toBe("2026-04-01");
  });

  it("clamps the final window at 24 months and marks completion", async () => {
    const { db, state } = setup({ backfillCursor: "2024-09-05" });

    const result = await runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    });

    expect(result).toMatchObject({ windowFrom: "2024-08-30", windowTo: "2024-09-05", done: true });
    expect(state.backfillCursor).toBe("2024-08-30");
    expect(state.backfillCompletedAt).toEqual(now);
    expect(listRawGmailMessagesInWindow).toHaveBeenCalledWith(
      gmail,
      expect.objectContaining({
        after: new Date("2024-08-30T00:00:00.000Z"),
        before: new Date("2024-09-05T00:00:00.000Z"),
      }),
    );
  });

  it("finishes without fetching when the cursor already covers 24 months", async () => {
    const { db, state } = setup({ backfillCursor: "2024-08-30" });

    const result = await runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    });

    expect(result).toEqual({
      processed: 0,
      imported: 0,
      windowFrom: "2024-08-30",
      windowTo: "2024-08-30",
      done: true,
    });
    expect(listRawGmailMessagesInWindow).not.toHaveBeenCalled();
    expect(state.backfillCompletedAt).toEqual(now);
  });

  it("refuses to run without owner consent", async () => {
    const { db } = setup({ backfillRequestedAt: null });

    await expect(runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    })).rejects.toThrow(/not requested/i);

    expect(getAuthedGmail).not.toHaveBeenCalled();
  });

  it("is idempotent when the same window is retried", async () => {
    const { db, state } = setup();
    const seen = new Set<string>();
    vi.mocked(processRawGmailMessage).mockImplementation(async (_db, { message: candidate }) => {
      const transactionAction = seen.has(candidate.messageId) ? "skipped" : "created";
      seen.add(candidate.messageId);
      return { transactionAction } as never;
    });
    const args = { connectionId: "conn-a", windowDays: 30, maxMessages: 500, now };

    expect((await runBackfillChunk(db as never, args)).imported).toBe(1);
    state.backfillCursor = "2026-08-30";
    expect((await runBackfillChunk(db as never, args)).imported).toBe(0);
  });

  it("does not advance the cursor when the window fetch fails", async () => {
    const { db, state, update } = setup({ backfillCursor: "2026-05-01" });
    vi.mocked(listRawGmailMessagesInWindow).mockRejectedValueOnce(new Error("invalid_grant"));

    await expect(runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    })).rejects.toThrow("invalid_grant");

    expect(state.backfillCursor).toBe("2026-05-01");
    expect(update).not.toHaveBeenCalled();
    expect(flushTokens).toHaveBeenCalledOnce();
  });

  it("does not advance the cursor when processing one message fails", async () => {
    const { db, state, update } = setup({ backfillCursor: "2026-05-01" });
    vi.mocked(processRawGmailMessage).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    })).rejects.toThrow("database unavailable");

    expect(state.backfillCursor).toBe("2026-05-01");
    expect(update).not.toHaveBeenCalled();
  });

  it("processes in scan mode without stamping lastScanAt", async () => {
    const { db, state, update } = setup();

    const result = await runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    });

    expect(result).toMatchObject({ processed: 1, imported: 1 });
    expect(processRawGmailMessage).toHaveBeenCalledWith(db, {
      userId: "user-1",
      message,
      mode: "scan",
      connectionId: "conn-a",
    });
    expect(update.mock.calls[0]?.[0].data).not.toHaveProperty("lastScanAt");
    expect(state.lastScanAt).toBeNull();
    expect(flushTokens).toHaveBeenCalledOnce();
  });

  it("treats a malformed cursor as a safe restart from today", async () => {
    const { db } = setup({ backfillCursor: "not-a-date" });

    const result = await runBackfillChunk(db as never, {
      connectionId: "conn-a",
      windowDays: 30,
      maxMessages: 500,
      now,
    });

    expect(result).toMatchObject({ windowTo: "2026-08-30", windowFrom: "2026-07-31" });
  });
});
