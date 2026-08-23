import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { DELETE } from "./route";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/prisma", () => ({ prisma: { walletCaptureDiagnostic: { deleteMany: vi.fn() } } }));

describe("wallet diagnostic deletion", () => {
  it("scopes early deletion to the signed-in owner", async () => {
    vi.mocked(prisma.walletCaptureDiagnostic.deleteMany).mockResolvedValue({ count: 1 });
    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ id: "diag-1" }) });
    expect(response.status).toBe(200);
    expect(prisma.walletCaptureDiagnostic.deleteMany).toHaveBeenCalledWith({ where: { id: "diag-1", userId: "user-1" } });
  });
});
