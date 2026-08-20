import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQuotes, isMarketLensConfigured } from "@/lib/services/marketlens";
import { readProviderKeys } from "@/lib/security/providerKeys";
import { refreshHoldingPrices } from "./refreshHoldingPrices";

vi.mock("@/lib/services/marketlens", () => ({
  fetchQuotes: vi.fn(),
  isMarketLensConfigured: vi.fn(),
}));

vi.mock("@/lib/security/providerKeys", () => ({ readProviderKeys: vi.fn() }));

function prismaMock() {
  return {
    holding: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "holding-1",
          symbol: "AAPL",
          lastPriceMinor: 10_000,
          priceCurrency: "USD",
          account: { type: "RRSP" },
        },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
    providerCredential: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

function quoteBatch(expectedSession: string, tradeDate: string) {
  return {
    pricing: "daily-close",
    expectedSession,
    truncated: [],
    quotes: [
      {
        symbol: "AAPL",
        status: "FRESH" as const,
        close: 110,
        currency: "USD",
        tradeDate,
        source: "YAHOO",
        keySource: "NONE" as const,
        staleTradingDays: 0,
        reason: null,
      },
    ],
  };
}

describe("refreshHoldingPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMarketLensConfigured).mockReturnValue(true);
    vi.mocked(readProviderKeys).mockResolvedValue({});
  });

  it("returns holding evidence only when a fresh quote matches MarketLens' expected session", async () => {
    const prisma = prismaMock();
    vi.mocked(fetchQuotes).mockResolvedValue(quoteBatch("2026-08-18", "2026-08-18"));

    const result = await refreshHoldingPrices(prisma as never, "user-1");

    expect(result.validatedHoldingIds).toEqual(["holding-1"]);
  });

  it("updates a provider quote but does not validate it for performance when its session is unexpected", async () => {
    const prisma = prismaMock();
    vi.mocked(fetchQuotes).mockResolvedValue(quoteBatch("2026-08-18", "2026-08-17"));

    const result = await refreshHoldingPrices(prisma as never, "user-1");

    expect(result.updated).toBe(1);
    expect(result.validatedHoldingIds).toEqual([]);
  });
});
