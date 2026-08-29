import { beforeEach, describe, expect, it, vi } from "vitest";

import { detectSubscriptionItem, POST } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { getAuthedGmail, listUserConnections } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRecentRawGmailMessages } from "@/lib/services/gmailScanSource";
import { processRawGmailMessage } from "@/lib/domain/receipts/gmailReceiptProcessing";
import { sendServiceFailureAlert } from "@/lib/services/alerting";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationSuggestion: { findUnique: vi.fn(), create: vi.fn() },
    detectedItem: { findFirst: vi.fn(), create: vi.fn() },
    emailConnection: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/services/gmailClient", () => ({ getAuthedGmail: vi.fn(), listUserConnections: vi.fn() }));
vi.mock("@/lib/services/gmailScanSource", () => ({
  hasGmailReadScope: vi.fn(),
  listRecentRawGmailMessages: vi.fn(),
}));
vi.mock("@/lib/domain/receipts/gmailReceiptProcessing", () => ({ processRawGmailMessage: vi.fn() }));
vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

function request() {
  return new Request("http://localhost/api/automation/scan", { method: "POST", body: "{}" });
}

const flushTokens = vi.fn();

function processedSuggestion(type: "SUBSCRIPTION" | "BILL") {
  const body = type === "SUBSCRIPTION"
    ? "Your subscription will be charged $16.49."
    : "Your statement is ready. Amount due $84.20.";

  return {
    parserError: null,
    transactionAction: "created",
    transaction: {
      subject: type === "SUBSCRIPTION" ? "Upcoming subscription charge" : "Your monthly statement is ready",
      purchasedAt: new Date("2026-08-20T00:00:00.000Z"),
      merchant: "Example Merchant",
      totalCents: type === "SUBSCRIPTION" ? 1649 : 8420,
      currency: "CAD",
      rawSource: "text",
    },
    parsedPurchase: { textBody: body, totalCents: type === "SUBSCRIPTION" ? 1649 : 8420, rawSource: "text" },
  };
}

describe("POST /api/automation/scan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(listUserConnections).mockResolvedValue([{
      id: "conn-a",
      userId: "user-1",
      emailAddress: "first@gmail.com",
      scanMode: "ALL",
    }] as never);
    vi.mocked(getAuthedGmail).mockResolvedValue({
      gmail: {},
      conn: { scope: "https://www.googleapis.com/auth/gmail.readonly", scanMode: "ALL" },
      flushTokens,
    } as never);
    vi.mocked(hasGmailReadScope).mockReturnValue(true);
    vi.mocked(listRecentRawGmailMessages).mockResolvedValue([{ messageId: "gmail-1" }] as never);
    vi.mocked(prisma.automationSuggestion.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.detectedItem.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.emailConnection.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it("does not invent a renewal date or cadence for a subscription email without an explicit renewal date", async () => {
    vi.mocked(processRawGmailMessage).mockResolvedValue(processedSuggestion("SUBSCRIPTION") as never);

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(prisma.automationSuggestion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "SUBSCRIPTION", draft: {} }),
    }));
  });

  it("does not invent a due day for a bill email without a due date", async () => {
    vi.mocked(processRawGmailMessage).mockResolvedValue(processedSuggestion("BILL") as never);

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(prisma.automationSuggestion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "BILL", draft: { autopay: false } }),
    }));
  });

  it("stamps lastScanAt when the scan completes", async () => {
    vi.mocked(processRawGmailMessage).mockResolvedValue(processedSuggestion("SUBSCRIPTION") as never);

    await POST(request() as never);

    expect(prisma.emailConnection.updateMany).toHaveBeenCalledWith(
      {
        where: { id: "conn-a", userId: "user-1" },
        data: { lastScanAt: expect.any(Date), lastScanError: null },
      },
    );
    expect(sendServiceFailureAlert).not.toHaveBeenCalled();
  });

  it("does NOT stamp lastScanAt when the scan throws", async () => {
    // Stamping unconditionally makes a broken integration indistinguishable
    // from a quiet inbox, and lends the failure false credibility.
    vi.mocked(listRecentRawGmailMessages).mockRejectedValue(new Error("Gmail API is disabled"));

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(prisma.emailConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "conn-a", userId: "user-1" },
      data: { lastScanError: "Gmail API is disabled" },
    });
    expect(sendServiceFailureAlert).toHaveBeenCalledOnce();
    expect(sendServiceFailureAlert).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: "automation/scan",
      summary: "Unhandled error during Gmail scan",
      error: "Gmail API is disabled",
      details: {
        connectionId: "conn-a",
        days: 90,
        fetched: 0,
      },
    }));

    const alert = vi.mocked(sendServiceFailureAlert).mock.calls[0][0];
    expect(alert).not.toHaveProperty("subject");
    expect(alert).not.toHaveProperty("sender");
    expect(alert.details).not.toHaveProperty("subject");
    expect(alert.details).not.toHaveProperty("sender");
  });

  it("still flushes refreshed tokens when the scan throws", async () => {
    // A token refreshed mid-scan is valid regardless of the failure; dropping
    // it would silently disconnect the owner.
    vi.mocked(listRecentRawGmailMessages).mockRejectedValue(new Error("boom"));

    await POST(request() as never);

    expect(flushTokens).toHaveBeenCalled();
  });

  it("scans every connection and reports per-connection totals", async () => {
    const gmailA = { mailbox: "a" };
    const gmailB = { mailbox: "b" };
    const flushA = vi.fn();
    const flushB = vi.fn();
    vi.mocked(listUserConnections).mockResolvedValue([
      { id: "conn-a", userId: "user-1", emailAddress: "first@gmail.com", scanMode: "ALL" },
      { id: "conn-b", userId: "user-1", emailAddress: "second@gmail.com", scanMode: "ALL" },
    ] as never);
    vi.mocked(getAuthedGmail).mockImplementation(async (connectionId) => ({
      gmail: connectionId === "conn-a" ? gmailA : gmailB,
      conn: { scope: "https://www.googleapis.com/auth/gmail.readonly" },
      flushTokens: connectionId === "conn-a" ? flushA : flushB,
    }) as never);
    vi.mocked(listRecentRawGmailMessages)
      .mockResolvedValueOnce([{ messageId: "gmail-a" }] as never)
      .mockResolvedValueOnce([{ messageId: "gmail-b" }] as never);
    vi.mocked(processRawGmailMessage)
      .mockResolvedValueOnce(processedSuggestion("SUBSCRIPTION") as never)
      .mockResolvedValueOnce(processedSuggestion("BILL") as never);

    const body = await (await POST(request() as never)).json();

    expect(body.perConnection).toEqual([
      expect.objectContaining({ connectionId: "conn-a", emailAddress: "first@gmail.com", fetched: 1, imported: 1 }),
      expect.objectContaining({ connectionId: "conn-b", emailAddress: "second@gmail.com", fetched: 1, imported: 1 }),
    ]);
    expect(body.importedEmails).toBe(2);
    expect(processRawGmailMessage).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({ connectionId: "conn-a" }));
    expect(processRawGmailMessage).toHaveBeenNthCalledWith(2, prisma, expect.objectContaining({ connectionId: "conn-b" }));
    expect(flushA).toHaveBeenCalledOnce();
    expect(flushB).toHaveBeenCalledOnce();
  });

  it("keeps scanning after one connection fails", async () => {
    vi.mocked(listUserConnections).mockResolvedValue([
      { id: "conn-a", userId: "user-1", emailAddress: "first@gmail.com", scanMode: "ALL" },
      { id: "conn-b", userId: "user-1", emailAddress: "second@gmail.com", scanMode: "ALL" },
    ] as never);
    vi.mocked(getAuthedGmail)
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockResolvedValueOnce({
        gmail: {},
        conn: { scope: "https://www.googleapis.com/auth/gmail.readonly" },
        flushTokens,
      } as never);
    vi.mocked(processRawGmailMessage).mockResolvedValue(processedSuggestion("SUBSCRIPTION") as never);

    const response = await POST(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.perConnection).toContainEqual(expect.objectContaining({
      connectionId: "conn-a",
      error: "invalid_grant",
    }));
    expect(body.perConnection).toContainEqual(expect.objectContaining({
      connectionId: "conn-b",
      imported: 1,
    }));
  });
});

describe("detectSubscriptionItem", () => {
  it("returns null when neither trial nor renewal evidence is present", () => {
    expect(detectSubscriptionItem("Your order has shipped", "Order total $42.00")).toBeNull();
  });
});
