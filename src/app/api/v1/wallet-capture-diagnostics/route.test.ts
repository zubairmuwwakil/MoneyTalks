import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { POST } from "./route";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  walletCaptureDiagnostic: { deleteMany: vi.fn(), upsert: vi.fn() },
  walletEvent: { findFirst: vi.fn() },
} }));

const baseReport = {
  reportID: "014d1748-c399-4fe4-89ba-9c76a96beeff", preparedAt: "2026-08-23T10:00:00Z",
  eventID: "abcd1234", serverEventID: "event-full", deliveryState: "quarantined",
  amountDecodeStatus: "undecodable", missingFields: ["amountDecimal"], attemptCount: 2,
  safeError: "invalid", httpStatus: 400, appVersion: "1", buildNumber: "2", osVersion: "iOS 26",
  captureVersion: 1, locationOutcome: "timedOut", locationAccuracyCategory: null,
  timeline: [{ at: "2026-08-23T10:00:00Z", stage: "savedLocally", detail: null }],
  includedTransactionDetails: false, transactionDetails: null,
};

describe("wallet diagnostic submission", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.walletCaptureDiagnostic.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.walletEvent.findFirst).mockResolvedValue({ id: "internal-event" } as never);
    vi.mocked(prisma.walletCaptureDiagnostic.upsert).mockResolvedValue({
      id: "diag-1", userId: "user-1", walletEventId: "internal-event", clientReportId: baseReport.reportID,
      includedTransactionDetails: false, snapshot: {}, submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  });
  it("stores only the validated redacted snapshot and references the owned server event", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(baseReport) }));
    expect(response.status).toBe(200);
    expect(prisma.walletEvent.findFirst).toHaveBeenCalledWith({ where: { userId: "user-1", eventId: "event-full" }, select: { id: true } });
    expect(prisma.walletCaptureDiagnostic.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      userId: "user-1", walletEventId: "internal-event", includedTransactionDetails: false,
    }) }));
    const expiry = new Date((await response.json()).expiresAt);
    expect(expiry.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });
  it("rejects transaction details unless inclusion is explicit", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ ...baseReport, transactionDetails: { merchant: "Secret" } }) }));
    expect(response.status).toBe(400);
    expect(prisma.walletCaptureDiagnostic.upsert).not.toHaveBeenCalled();
  });
  it("requires an authenticated account session", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(baseReport) }));
    expect(response.status).toBe(401);
  });
});
