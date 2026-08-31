import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { recordSubscriptionDataOperation } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordSubscriptionDataOperation: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailConnection: { findMany: vi.fn() },
    emailTransaction: { findMany: vi.fn() },
    receiptUpload: { findMany: vi.fn() },
    purchase: { findMany: vi.fn() },
    returnItem: { findMany: vi.fn() },
    subscription: { findMany: vi.fn() },
    subscriptionPayment: { findMany: vi.fn() },
    detectedItem: { findMany: vi.fn() },
    automationSuggestion: { findMany: vi.fn() },
    notification: { findMany: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
    snoozedEvent: { findMany: vi.fn() },
    valueEvent: { findMany: vi.fn() },
    bill: { findMany: vi.fn() },
    emailObligationFact: { findMany: vi.fn() },
    recurringObligation: { findMany: vi.fn() },
    recurringObligationOwnerFact: { findMany: vi.fn() },
    legacySubscriptionMapping: { findMany: vi.fn() },
  },
}));

describe("GET /api/data/export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    for (const model of [
      prisma.emailTransaction,
      prisma.receiptUpload,
      prisma.purchase,
      prisma.returnItem,
      prisma.subscription,
      prisma.subscriptionPayment,
      prisma.detectedItem,
      prisma.automationSuggestion,
      prisma.notification,
      prisma.snoozedEvent,
      prisma.valueEvent,
      prisma.bill,
      prisma.emailObligationFact,
      prisma.recurringObligation,
      prisma.recurringObligationOwnerFact,
      prisma.legacySubscriptionMapping,
    ]) {
      vi.mocked(model.findMany).mockResolvedValue([] as never);
    }
    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.emailConnection.findMany).mockResolvedValue([
      { id: "conn-a", emailAddress: "first@gmail.com" },
      { id: "conn-b", emailAddress: "second@gmail.com" },
    ] as never);
  });

  it("exports every connection without credential ciphertext", async () => {
    const body = await (await GET()).json();

    expect(body.emailConnections).toHaveLength(2);
    expect(body).not.toHaveProperty("emailConnection");
    expect(JSON.stringify(body)).not.toContain("refresh-token-plaintext");
    expect(prisma.emailConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" },
      select: expect.not.objectContaining({ accessToken: true, refreshToken: true }),
    }));
    expect(recordSubscriptionDataOperation).toHaveBeenCalledWith({ operation: "export", outcome: "success" });
  });

  it("exports the lifecycle facts derived from the owner's mail", async () => {
    vi.mocked(prisma.emailObligationFact.findMany).mockResolvedValue([
      { id: "fact-1", type: "CANCELLATION", evidenceSnippet: "your subscription has been cancelled" },
    ] as never);

    const body = await (await GET()).json();

    expect(body.emailObligationFacts).toHaveLength(1);
    expect(body.emailObligationFacts[0].evidenceSnippet).toContain("has been cancelled");
    expect(prisma.emailObligationFact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
  });

  it("records an export failure before preserving the route error", async () => {
    vi.mocked(prisma.recurringObligation.findMany).mockRejectedValue(new Error("database unavailable"));

    await expect(GET()).rejects.toThrow("database unavailable");

    expect(recordSubscriptionDataOperation).toHaveBeenCalledWith({ operation: "export", outcome: "failure" });
  });

});
