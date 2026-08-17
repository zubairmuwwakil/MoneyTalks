import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, ipSubmissions } from "./route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    waitlist: { findUnique: vi.fn(), create: vi.fn() },
  }
}));

describe("POST /api/waitlist", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    ipSubmissions.clear();
  });

  it("validates email", async () => {
    const req = new NextRequest("http://localhost/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "invalid" }),
      headers: { "x-forwarded-for": "1.2.3.4" }
    });
    
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid email");
  });

  it("dedupes existing email", async () => {
    vi.mocked(prisma.waitlist.findUnique).mockResolvedValue({ id: "1", email: "test@example.com", createdAt: new Date(), invitedAt: null });

    const req = new NextRequest("http://localhost/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "test@example.com" }),
      headers: { "x-forwarded-for": "1.2.3.4" }
    });
    
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Already on waitlist");
    expect(prisma.waitlist.create).not.toHaveBeenCalled();
  });

  it("creates new entry", async () => {
    vi.mocked(prisma.waitlist.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.waitlist.create).mockResolvedValue({ id: "1", email: "test@example.com", createdAt: new Date(), invitedAt: null });

    const req = new NextRequest("http://localhost/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "test@example.com" }),
      headers: { "x-forwarded-for": "1.2.3.4" }
    });
    
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.waitlist.create).toHaveBeenCalledWith({ data: { email: "test@example.com" } });
  });

  it("enforces IP cap", async () => {
    vi.mocked(prisma.waitlist.findUnique).mockResolvedValue(null);

    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      const req = new NextRequest("http://localhost/api/waitlist", {
        method: "POST",
        body: JSON.stringify({ email: `test${i}@example.com` }),
        headers: { "x-forwarded-for": "1.1.1.1" }
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // 6th request should fail
    const req6 = new NextRequest("http://localhost/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "test6@example.com" }),
      headers: { "x-forwarded-for": "1.1.1.1" }
    });
    const res6 = await POST(req6);
    expect(res6.status).toBe(429);
    const data = await res6.json();
    expect(data.error).toBe("Too many submissions");
  });
});
