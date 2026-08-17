import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkSavedCardToContract } from "./actions";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { creditCard: { updateMany: vi.fn() }, cardAlias: { upsert: vi.fn() }, walletEvent: { updateMany: vi.fn() } } }));

describe("linkSavedCardToContract", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(requireUserId).mockResolvedValue("user-1"); });

  it("writes only the signed-in user's confirmed catalogue identity", async () => {
    vi.mocked(prisma.creditCard.updateMany).mockResolvedValue({ count: 1 } as never);
    await expect(linkSavedCardToContract({ cardId: "card-1", contractCardId: "amex-cobalt" })).resolves.toEqual({ ok: true });
    expect(prisma.creditCard.updateMany).toHaveBeenCalledWith({
      where: { id: "card-1", userId: "user-1" }, data: { contractCardId: "amex-cobalt" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/wallet");
  });

  it("rejects unknown contracts without writing", async () => {
    await expect(linkSavedCardToContract({ cardId: "card-1", contractCardId: "made-up" })).resolves.toEqual({ ok: false, error: "unknown catalogue card" });
    expect(prisma.creditCard.updateMany).not.toHaveBeenCalled();
  });
});
