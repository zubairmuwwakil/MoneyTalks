import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { setCardShoppingMarket } from "./actions";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { profile: { upsert: vi.fn() } } }));

describe("setCardShoppingMarket", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  it("persists an explicit market without changing residency", async () => {
    vi.mocked(prisma.profile.upsert).mockResolvedValue({} as never);

    await expect(setCardShoppingMarket("US")).resolves.toEqual({ ok: true });

    expect(prisma.profile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { cardShoppingMarket: "US" },
      create: { userId: "user-1", cardShoppingMarket: "US" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/cards/new");
  });

  it("rejects an unsupported market without writing a preference", async () => {
    await expect(setCardShoppingMarket("GB")).resolves.toEqual({
      ok: false,
      error: "Choose Canada or the United States.",
    });
    expect(prisma.profile.upsert).not.toHaveBeenCalled();
  });
});
