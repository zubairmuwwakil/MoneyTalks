import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { walletEvent: { findMany: vi.fn() } } }));

describe("GET /api/spine/feedback", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires a Clerk session", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns recent persisted WalletEvent verdicts for only the signed-in owner", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.walletEvent.findMany).mockResolvedValue([{
      eventId: "wevt-1", capturedAt: new Date("2026-08-17T13:30:00Z"), merchantRaw: "Coffee",
      amountRaw: 6.42, currencyRaw: "CAD", cardRaw: "Amex Cobalt", feedbackVerdict: "warning",
      feedbackWarning: "⚠ Cobalt would have earned ~$0.74 more",
    }] as never);

    const response = await GET();
    expect(await response.json()).toEqual({ feedback: [{
      eventId: "wevt-1", capturedAt: "2026-08-17T13:30:00.000Z", merchantRaw: "Coffee",
      amountMinor: 642, currency: "CAD", cardRaw: "Amex Cobalt", verdict: "warning",
      warning: "⚠ Cobalt would have earned ~$0.74 more",
    }] });
    expect(prisma.walletEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", feedbackVerdict: { not: null } }, take: 50,
    }));
  });
});
