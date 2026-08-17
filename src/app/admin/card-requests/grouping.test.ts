import { describe, it, expect, vi } from "vitest";
import CardRequestsAdminPage from "./page";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cardRequest: { groupBy: vi.fn() },
  }
}));

vi.mock("@/lib/require-user", () => ({
  requireUserId: vi.fn()
}));

describe("CardRequestsAdminPage", () => {
  it("groups by issuer and cardName", async () => {
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.cardRequest.groupBy).mockResolvedValue([
      { issuer: "Amex", cardName: "Platinum", _count: { _all: 5 } },
    ] as any);

    const result = await CardRequestsAdminPage();
    
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
