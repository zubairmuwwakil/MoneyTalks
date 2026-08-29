import { beforeEach, describe, expect, it, vi } from "vitest";

import { detectSubscriptionItem, POST } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { getAuthedGmail } from "@/lib/services/gmailClient";
import { hasGmailReadScope, listRecentRawGmailMessages } from "@/lib/services/gmailScanSource";
import { processRawGmailMessage } from "@/lib/domain/receipts/gmailReceiptProcessing";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationSuggestion: { findUnique: vi.fn(), create: vi.fn() },
    detectedItem: { findFirst: vi.fn(), create: vi.fn() },
    emailConnection: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/services/gmailClient", () => ({ getAuthedGmail: vi.fn() }));
vi.mock("@/lib/services/gmailScanSource", () => ({
  hasGmailReadScope: vi.fn(),
  listRecentRawGmailMessages: vi.fn(),
}));
vi.mock("@/lib/domain/receipts/gmailReceiptProcessing", () => ({ processRawGmailMessage: vi.fn() }));

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
});

describe("detectSubscriptionItem", () => {
  it("returns null when neither trial nor renewal evidence is present", () => {
    expect(detectSubscriptionItem("Your order has shipped", "Order total $42.00")).toBeNull();
  });
});
