import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { requireUserId } from "@/lib/require-user";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cardRequest: { findFirst: vi.fn(), create: vi.fn() },
  }
}));

vi.mock("@/lib/require-user", () => ({
  requireUserId: vi.fn()
}));

describe("POST /api/card-requests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  it("validates data", async () => {
    const req = new NextRequest("http://localhost/api/card-requests", {
      method: "POST",
      body: JSON.stringify({ issuer: "" }) // Invalid, missing cardName and issuer empty
    });
    
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("dedupes requests", async () => {
    vi.mocked(prisma.cardRequest.findFirst).mockResolvedValue({ id: "1" } as never);

    const req = new NextRequest("http://localhost/api/card-requests", {
      method: "POST",
      body: JSON.stringify({ issuer: "Amex", cardName: "Platinum" })
    });
    
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Already requested");
    expect(prisma.cardRequest.create).not.toHaveBeenCalled();
  });

  it("creates request", async () => {
    vi.mocked(prisma.cardRequest.findFirst).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/card-requests", {
      method: "POST",
      body: JSON.stringify({ issuer: "Amex", cardName: "Platinum", note: "Please add this" })
    });
    
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.cardRequest.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        issuer: "Amex",
        cardName: "Platinum",
        note: "Please add this"
      }
    });
  });

  it("requires auth", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Error("unauthorized"));

    const req = new NextRequest("http://localhost/api/card-requests", {
      method: "POST",
      body: JSON.stringify({ issuer: "Amex", cardName: "Platinum" })
    });
    
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
