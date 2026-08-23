import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({ prisma: { walletInstallation: { findUnique: vi.fn(), update: vi.fn() } } }));

describe("wallet installation self-revocation", () => {
  const request = () => new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer token" } });
  beforeEach(() => vi.clearAllMocks());

  it("revokes an active installation", async () => {
    const tokenHash = createHash("sha256").update("token").digest("hex");
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({ id: "inst", tokenHash, revokedAt: null } as never);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(prisma.walletInstallation.update).toHaveBeenCalledWith({ where: { id: "inst" }, data: { revokedAt: expect.any(Date) } });
  });

  it("is idempotent when the installation was already revoked", async () => {
    const tokenHash = createHash("sha256").update("token").digest("hex");
    vi.mocked(prisma.walletInstallation.findUnique).mockResolvedValue({ id: "inst", tokenHash, revokedAt: new Date() } as never);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(prisma.walletInstallation.update).not.toHaveBeenCalled();
  });
});
