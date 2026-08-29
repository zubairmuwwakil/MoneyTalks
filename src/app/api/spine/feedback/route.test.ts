import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
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
      eventId: "wevt-1", capturedAt: new Date("2026-08-17T13:30:00Z"),
      capturedAtRaw: "2026-08-17T09:30:00-04:00", capturedTimezone: "America/Toronto",
      merchantRaw: "Coffee", merchantNormalized: "Cafe",
      amountRaw: new Prisma.Decimal("6.42"), currencyRaw: "CAD", cardRaw: "Amex Cobalt",
      resolvedCardId: "amex-cobalt",
      latitude: 43.8501, longitude: -79.0202, locationAccuracyMeters: 14.5,
      feedbackVerdict: "warning",
      feedbackWarning: "⚠ Cobalt would have earned ~$0.74 more",
    }] as never);

    const response = await GET();
    expect(await response.json()).toEqual({ feedback: [{
      eventId: "wevt-1", capturedAt: "2026-08-17T13:30:00.000Z",
      capturedAtRaw: "2026-08-17T09:30:00-04:00", capturedTimezone: "America/Toronto",
      merchantRaw: "Coffee", merchantNormalized: "Cafe",
      amountMinor: 642, currency: "CAD", cardRaw: "Amex Cobalt",
      resolvedCardId: "amex-cobalt",
      latitude: 43.8501, longitude: -79.0202, locationAccuracyMeters: 14.5,
      verdict: "warning",
      warning: "⚠ Cobalt would have earned ~$0.74 more",
    }] });
    expect(prisma.walletEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", feedbackVerdict: { not: null } }, take: 50,
    }));
  });

  // The alias table is the only thing allowed to map cardRaw to a catalogue id. An event it has
  // not resolved must say so plainly, so the consumer leaves the card blank instead of guessing.
  it("reports an unresolved card as null rather than omitting the field", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.walletEvent.findMany).mockResolvedValue([{
      eventId: "wevt-2", capturedAt: new Date("2026-08-17T13:30:00Z"),
      capturedAtRaw: null, capturedTimezone: null,
      merchantRaw: "SQ *CAFE", merchantNormalized: null,
      amountRaw: new Prisma.Decimal("6.42"), currencyRaw: "CAD",
      cardRaw: "Some Unknown Card", resolvedCardId: null,
      latitude: null, longitude: null, locationAccuracyMeters: null,
      feedbackVerdict: "unknown", feedbackWarning: null,
    }] as never);

    const { feedback } = await (await GET()).json();
    expect(feedback[0].resolvedCardId).toBeNull();
  });
});
