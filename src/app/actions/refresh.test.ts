import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPrices } from "./refresh";
import { prisma } from "@/lib/prisma";
import { refreshHoldingPrices } from "@/lib/domain/investments/refreshHoldingPrices";
import { captureInvestmentSnapshots } from "@/lib/domain/investments/captureInvestmentSnapshots";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/services/marketlens", () => ({ isMarketLensConfigured: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/fetch-prices", () => ({ fetchCryptoPricesMinor: vi.fn() }));
vi.mock("@/lib/fetch-fx", () => ({ fetchUsdCadRate: vi.fn() }));
vi.mock("@/lib/domain/investments/refreshHoldingPrices", () => ({ refreshHoldingPrices: vi.fn() }));
vi.mock("@/lib/domain/investments/captureInvestmentSnapshots", () => ({
  captureInvestmentSnapshots: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findFirst: vi.fn() },
    holding: { update: vi.fn() },
  },
}));

describe("refreshPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({
      id: "account-1",
      currency: "CAD",
      type: "TFSA",
      holdings: [{ id: "holding-1", symbol: "SHOP" }],
    } as never);
    vi.mocked(refreshHoldingPrices).mockResolvedValue({
      ok: true,
      updated: 1,
      skipped: [],
      validatedHoldingIds: ["holding-1"],
      sources: { YAHOO: 1 },
    });
    vi.mocked(captureInvestmentSnapshots).mockResolvedValue({
      accounts: 1,
      complete: 1,
      partial: 0,
      failed: 0,
      failures: [],
    });
  });

  it("captures the user's daily valuation after a manual quote refresh", async () => {
    const formData = new FormData();
    formData.append("accountId", "account-1");

    await expect(refreshPrices(formData)).rejects.toThrow("REDIRECT:");

    expect(refreshHoldingPrices).toHaveBeenCalledWith(prisma, "user-1", {
      accountId: "account-1",
    });
    expect(captureInvestmentSnapshots).toHaveBeenCalledWith(prisma, "user-1", {
      accountId: "account-1",
      validatedHoldingIds: ["holding-1"],
    });
    expect(vi.mocked(refreshHoldingPrices).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(captureInvestmentSnapshots).mock.invocationCallOrder[0],
    );
  });

  it("surfaces a targeted snapshot failure even when the quote refresh succeeded", async () => {
    vi.mocked(captureInvestmentSnapshots).mockResolvedValueOnce({
      accounts: 1,
      complete: 0,
      partial: 0,
      failed: 1,
      failures: [{ accountId: "account-1", reason: "PrismaClientKnownRequestError" }],
    });
    const formData = new FormData();
    formData.append("accountId", "account-1");

    await expect(refreshPrices(formData)).rejects.toThrow(
      /pricesError=Prices%20were%20refreshed%2C%20but%20the%20performance%20snapshot%20could%20not%20be%20recorded/,
    );
  });
});
