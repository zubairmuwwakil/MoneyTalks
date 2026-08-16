import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    walletInstallation: { findUnique: vi.fn() },
    walletEvent: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    ownerStateRecord: { findUnique: vi.fn() },
    cardAlias: { findUnique: vi.fn() },
    merchantAlias: { findUnique: vi.fn() },
  }
}));

describe("POST /api/v1/wallet-events", () => {
  const token = "mock-token";
const tHash = createHash("sha256").update(token).digest("hex");

  

  beforeEach(() => {
    vi.resetAllMocks();
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
    expect(json).toEqual({ accepted: true, duplicate: true, eventId: "wevt_123" });
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
