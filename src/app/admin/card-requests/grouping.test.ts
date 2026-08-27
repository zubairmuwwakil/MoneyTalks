import { describe, it, expect, vi } from "vitest";
import CardRequestsAdminPage from "./page";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-user";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cardRequest: { groupBy: vi.fn() },
  }
}));

vi.mock("@/lib/require-user", () => ({
  requireAdmin: vi.fn()
}));

describe("CardRequestsAdminPage", () => {
  it("groups by issuer and cardName", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "user-1", email: "owner@example.com" });
    vi.mocked(prisma.cardRequest.groupBy).mockResolvedValue([
      { issuer: "Amex", cardName: "Platinum", _count: { _all: 5 } },
    ] as never);

    const result = await CardRequestsAdminPage({ searchParams: Promise.resolve({}) });
    
    expect(prisma.cardRequest.groupBy).toHaveBeenCalledWith({
      by: ["issuer", "cardName"],
      _count: { _all: true },
      orderBy: {
        _count: { cardName: "desc" },
      },
    });
    
    // Check it renders correctly
    expect(result).toBeTruthy();
  });
});
