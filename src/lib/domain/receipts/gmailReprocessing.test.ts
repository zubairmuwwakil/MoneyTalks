import { beforeEach, describe, expect, it, vi } from "vitest";

import { reprocessStoredGmailMessages } from "./gmailReprocessing";
import { processRawGmailMessage } from "./gmailReceiptProcessing";
import { getAuthedGmail, listUserConnections } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRecentRawGmailMessages } from "@/lib/services/gmailScanSource";

vi.mock("@/lib/services/gmailClient", () => ({ getAuthedGmail: vi.fn(), listUserConnections: vi.fn() }));
vi.mock("@/lib/services/gmailScanSource", () => ({
  hasGmailReadScope: vi.fn(),
  listRecentRawGmailMessages: vi.fn(),
}));
vi.mock("./gmailReceiptProcessing", () => ({ processRawGmailMessage: vi.fn() }));

const flushTokens = vi.fn();
const gmail = { users: { messages: {} } };

describe("reprocessStoredGmailMessages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listUserConnections).mockResolvedValue([{
      id: "conn-fictional",
      userId: "user-fictional",
      emailAddress: "owner@example.test",
    }] as never);
    vi.mocked(getAuthedGmail).mockResolvedValue({
      gmail,
      conn: { scope: "https://www.googleapis.com/auth/gmail.readonly" },
      flushTokens,
    } as never);
    vi.mocked(hasGmailReadScope).mockReturnValue(true);
    vi.mocked(listRecentRawGmailMessages).mockResolvedValue([{
      messageId: "message-fictional",
      raw: Buffer.from("fictional MIME"),
      subject: "Fictional notice",
      from: "sender@example.test",
      internalDate: new Date("2026-08-01T00:00:00.000Z"),
      rfc822MessageId: null,
    }]);
    vi.mocked(processRawGmailMessage).mockResolvedValue({
      parserError: null,
      purchaseAction: "none",
    } as never);
  });

  it("replays a stored message in fact-only mode and flushes refreshed tokens", async () => {
    const db = {} as never;

    const result = await reprocessStoredGmailMessages(db, {
      userId: "user-fictional",
      mode: "facts-reprocess",
      transactions: [{
        id: "tx-fictional",
        messageId: "message-fictional",
        connectionId: "conn-fictional",
      }],
    });

    expect(processRawGmailMessage).toHaveBeenCalledWith(db, {
      userId: "user-fictional",
      message: expect.objectContaining({ messageId: "message-fictional" }),
      mode: "facts-reprocess",
      connectionId: "conn-fictional",
    });
    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(flushTokens).toHaveBeenCalledOnce();
  });
});
