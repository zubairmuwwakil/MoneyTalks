import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    walletInstallation: { findUnique: vi.fn() },
    walletEvent: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    ownerStateRecord: { findUnique: vi.fn(), create: vi.fn() },
    creditCard: { findMany: vi.fn() },
    cardAlias: { findUnique: vi.fn() },
    merchantAlias: { findUnique: vi.fn() },
  }
}));

describe("POST /api/v1/wallet-events", () => {
  const token = "mock-token";
const tHash = createHash("sha256").update(token).digest("hex");

  

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.walletEvent.create).mockResolvedValue({ id: "evt-created" } as any);
    vi.mocked(prisma.walletEvent.update).mockResolvedValue({} as any);
    // Lazy owner-state provisioning: no cards → no default state → verdict stays "unknown".
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as any);
  });

  function mockReq(body: any, auth: string | null = `Bearer ${token}`) {
    const headers = new Headers();
    if (auth) headers.set("Authorization", auth);
    return new Request("http://localhost/api/v1/wallet-events", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  }

  it("rejects without valid token", async () => {
    const req = mockReq({}, null);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects revoked token", async () => {
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({
      id: "inst-1", userId: "user-1", tokenHash: createHash("sha256").update("mock-token").digest("hex"), revokedAt: new Date(), label: "Test", createdAt: new Date()
    });
    const req = mockReq({}, `Bearer ${token}`);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // I'll add more tests...

  it("handles idempotent replay", async () => {
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({
      id: "inst-1", userId: "user-1", tokenHash: createHash("sha256").update("mock-token").digest("hex"), revokedAt: null, label: "Test", createdAt: new Date()
    });
    vi.mocked(prisma.walletEvent.findUnique).mockResolvedValue({ id: "evt-1" } as any);

    const payload = {
      schemaVersion: 1, shortcutVersion: 1, source: "apple_wallet_shortcuts",
      eventId: "wevt_123", capturedAt: "2026-08-16T18:25:31-04:00", timezone: "America/Toronto",
      transaction: { merchantRaw: "Starbucks", amount: 6.42, currency: "CAD" }
    };
    
    const res = await POST(mockReq(payload));
    const json = await res.json();
    expect(json).toEqual({ accepted: true, duplicate: true, final: true, eventId: "wevt_123" });
  });

  it("marks fuzzy dup but never deletes", async () => {
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({
      id: "inst-1", userId: "user-1", tokenHash: createHash("sha256").update("mock-token").digest("hex"), revokedAt: null, label: "Test", createdAt: new Date()
    });
    vi.mocked(prisma.walletEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.walletEvent.findFirst).mockResolvedValue({ id: "evt-existing" } as any);

    const payload = {
      schemaVersion: 1, shortcutVersion: 1, source: "apple_wallet_shortcuts",
      eventId: "wevt_124", capturedAt: "2026-08-16T18:25:31-04:00", timezone: "America/Toronto",
      transaction: { merchantRaw: "Starbucks", amount: 6.42, currency: "CAD" }
    };
    
    await POST(mockReq(payload));
    expect(prisma.walletEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processingStatus: "POSSIBLE_DUPLICATE" })
    }));
  });

  it("handles currency null", async () => {
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({
      id: "inst-1", userId: "user-1", tokenHash: createHash("sha256").update("mock-token").digest("hex"), revokedAt: null, label: "Test", createdAt: new Date()
    });
    vi.mocked(prisma.walletEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.walletEvent.findFirst).mockResolvedValue(null);

    const payload = {
      schemaVersion: 1, shortcutVersion: 1, source: "apple_wallet_shortcuts",
      eventId: "wevt_125", capturedAt: "2026-08-16T18:25:31-04:00", timezone: "America/Toronto",
      transaction: { merchantRaw: "Starbucks", amount: 6.42, currency: null }
    };
    
    await POST(mockReq(payload));
    expect(prisma.walletEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assumedCurrency: true })
    }));
  });

  it("preserves capturedAt and creates uploadedAt", async () => {
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({
      id: "inst-1", userId: "user-1", tokenHash: createHash("sha256").update("mock-token").digest("hex"), revokedAt: null, label: "Test", createdAt: new Date()
    });
    vi.mocked(prisma.walletEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.walletEvent.findFirst).mockResolvedValue(null);

    const capturedAtStr = "2026-08-16T18:25:31-04:00";
    const payload = {
      schemaVersion: 1, shortcutVersion: 1, source: "apple_wallet_shortcuts",
      eventId: "wevt_126", capturedAt: capturedAtStr, timezone: "America/Toronto",
      transaction: { merchantRaw: "Starbucks", amount: 6.42, currency: "CAD" }
    };
    
    await POST(mockReq(payload));
    expect(prisma.walletEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ 
        capturedAt: new Date(capturedAtStr),
        // uploadedAt is handled by Prisma @default(now()) so we don't pass it explicitly, meaning it isn't overwritten
      })
    }));
  });

  describe("complete-record capture", () => {
    function mockAuthedNoDups() {
      vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({
        id: "inst-1", userId: "user-1", tokenHash: tHash, revokedAt: null, label: "Test", createdAt: new Date()
      });
      vi.mocked(prisma.walletEvent.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.walletEvent.findFirst).mockResolvedValue(null);
    }

    function basePayload(overrides: Record<string, any> = {}, txOverrides: Record<string, any> = {}) {
      return {
        schemaVersion: 1, shortcutVersion: 1, source: "apple_wallet_shortcuts",
        eventId: "wevt_cr", capturedAt: "2026-08-16T18:25:31-04:00", timezone: "America/Toronto",
        transaction: { merchantRaw: "Starbucks", amount: 6.42, currency: "CAD", cardRaw: "Amex Cobalt", ...txOverrides },
        ...overrides,
      };
    }

    function createdData() {
      return vi.mocked(prisma.walletEvent.create).mock.calls[0][0].data as any;
    }

    it("persists capturedAtRaw and capturedTimezone", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload()));
      expect(createdData()).toMatchObject({
        capturedAt: new Date("2026-08-16T18:25:31-04:00"),
        capturedAtRaw: "2026-08-16T18:25:31-04:00",
        capturedTimezone: "America/Toronto",
      });
    });

    it("nulls an invalid timezone but still stores the event", async () => {
      mockAuthedNoDups();
      const res = await POST(mockReq(basePayload({ timezone: "Eastern Time" })));
      expect(res.status).toBe(200);
      expect(createdData().capturedTimezone).toBeNull();
    });

    it("interprets an offset-less timestamp in the payload timezone", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload({ capturedAt: "2026-08-16 18:25:31" })));
      expect(createdData().capturedAt).toEqual(new Date("2026-08-16T18:25:31-04:00"));
      expect(createdData().capturedAtRaw).toBe("2026-08-16 18:25:31");
    });

    it("falls back to a valid server time when capturedAt is unparseable", async () => {
      mockAuthedNoDups();
      const res = await POST(mockReq(basePayload({ capturedAt: "not-a-real-date" })));
      expect(res.status).toBe(200);
      const captured = createdData().capturedAt;
      expect(captured).toBeInstanceOf(Date);
      expect(Number.isNaN(captured.getTime())).toBe(false);
      expect(createdData().capturedAtRaw).toBe("not-a-real-date");
    });

    it("accepts amount as a numeric string and stores it as an exact decimal string", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload({}, { amount: "6.42" })));
      expect(createdData().amountRaw).toBe("6.42");
    });

    it("absorbs locale-formatted currency strings from Shortcuts", async () => {
      const cases: Array<[string, string]> = [
        ["$6.42", "6.42"],
        ["CA$1,234.56", "1234.56"],
        ["6,42 $", "6.42"], // fr-CA decimal comma
        ["1 234,56 $", "1234.56"], // fr-CA with space thousands
        ["US$20.00", "20.00"],
      ];
      for (const [input, expected] of cases) {
        vi.resetAllMocks();
        vi.mocked(prisma.walletEvent.create).mockResolvedValue({ id: "evt-created" } as any);
        vi.mocked(prisma.walletEvent.update).mockResolvedValue({} as any);
        vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as any);
        mockAuthedNoDups();
        await POST(mockReq(basePayload({}, { amount: input })));
        expect(createdData().amountRaw, `input: ${input}`).toBe(expected);
      }
    });

    it("treats empty-string optional fields as missing, never zero", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload({}, { amount: "", currency: "", cardRaw: "", transactionNameRaw: "" })));
      expect(createdData()).toMatchObject({
        amountRaw: null, currencyRaw: null, cardRaw: null, transactionNameRaw: null, assumedCurrency: true,
      });
    });

    it("keeps a zero amount as zero in the fuzzy-dup filter", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload({}, { amount: 0 })));
      expect(prisma.walletEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ amountRaw: "0" }),
      }));
      expect(createdData().amountRaw).toBe("0");
    });

    it("marks definitive responses final, with notification only when a warning exists", async () => {
      mockAuthedNoDups();
      const res = await POST(mockReq(basePayload()));
      const json = await res.json();
      expect(json.final).toBe(true);
      expect(json.notification).toBeUndefined();
    });

    it("accepts the transaction as a JSON string (dictionary-as-text from Shortcuts)", async () => {
      mockAuthedNoDups();
      const res = await POST(mockReq(basePayload({
        transaction: JSON.stringify({ merchantRaw: "Starbucks", amount: "$6.42", cardRaw: "Amex Cobalt" }),
      })));
      expect(res.status).toBe(200);
      expect(createdData()).toMatchObject({
        merchantRaw: "Starbucks", amountRaw: "6.42", cardRaw: "Amex Cobalt",
      });
    });

    it("parses a location that arrives as a JSON string with numeric-string coords", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload({
        location: '{"latitude":"43.6532","longitude":"-79.3832","horizontalAccuracyMeters":"18"}',
      })));
      expect(createdData()).toMatchObject({
        latitude: 43.6532, longitude: -79.3832, locationAccuracyMeters: 18,
      });
    });

    it("accepts Shortcuts-native location keys", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload({
        location: { Latitude: 43.6532, Longitude: -79.3832, "Horizontal Accuracy": 18 },
      })));
      expect(createdData()).toMatchObject({
        latitude: 43.6532, longitude: -79.3832, locationAccuracyMeters: 18,
      });
    });

    it("drops out-of-range coordinates instead of storing garbage", async () => {
      mockAuthedNoDups();
      const res = await POST(mockReq(basePayload({
        location: { latitude: 999, longitude: -79.3832 },
      })));
      expect(res.status).toBe(200);
      expect(createdData()).toMatchObject({ latitude: null, longitude: null, locationAccuracyMeters: null });
    });

    it("stores the raw payload verbatim for forensics and re-parsing", async () => {
      mockAuthedNoDups();
      const payload = basePayload();
      await POST(mockReq(payload));
      expect(createdData().rawPayload).toEqual(payload);
    });

    it("records resolved merchant and card identities at capture time", async () => {
      mockAuthedNoDups();
      vi.mocked(prisma.merchantAlias.findUnique).mockResolvedValue({ normalizedName: "Starbucks" } as any);
      vi.mocked(prisma.cardAlias.findUnique).mockResolvedValue({ cardId: "amex-cobalt" } as any);
      await POST(mockReq(basePayload()));
      expect(createdData()).toMatchObject({
        merchantNormalized: "Starbucks", resolvedCardId: "amex-cobalt",
      });
    });

    it("leaves resolution fields null when no alias matches", async () => {
      mockAuthedNoDups();
      await POST(mockReq(basePayload()));
      expect(createdData()).toMatchObject({ merchantNormalized: null, resolvedCardId: null });
    });
  });

  it("returns unknown when no alias exists", async () => {
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({
      id: "inst-1", userId: "user-1", tokenHash: createHash("sha256").update("mock-token").digest("hex"), revokedAt: null, label: "Test", createdAt: new Date()
    });
    vi.mocked(prisma.walletEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.walletEvent.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue({ stateData: {} } as any);
    vi.mocked(prisma.cardAlias.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.merchantAlias.findUnique).mockResolvedValue(null);

    const payload = {
      schemaVersion: 1, shortcutVersion: 1, source: "apple_wallet_shortcuts",
      eventId: "wevt_127", capturedAt: "2026-08-16T18:25:31-04:00", timezone: "America/Toronto",
      transaction: { merchantRaw: "Unknown Merchant", amount: 6.42, currency: "CAD", cardRaw: "Unknown Card" }
    };
    
    const res = await POST(mockReq(payload));
    const json = await res.json();
    expect(json.feedback.verdict).toBe("unknown");
    expect(json.feedback.warning).toBeUndefined();
  });
});
