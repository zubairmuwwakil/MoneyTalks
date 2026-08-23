import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({ prisma: { walletInstallation: { findUnique: vi.fn() } } }));

describe("wallet installation connection test", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not create a purchase and verifies an active installation token", async () => {
    const hash = createHash("sha256").update("token").digest("hex");
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({ id: "inst", userId: "user", tokenHash: hash, revokedAt: null } as never);
    const response = await POST(new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer token" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true, installationId: "inst" });
  });
  it("rejects a revoked token", async () => {
    const hash = createHash("sha256").update("token").digest("hex");
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({ id: "inst", tokenHash: hash, revokedAt: new Date() } as never);
    const response = await POST(new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer token" } }));
    expect(response.status).toBe(401);
  });
});
