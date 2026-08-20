import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQuotes, isMarketLensConfigured } from "@/lib/services/marketlens";
import { readProviderKeys } from "@/lib/security/providerKeys";
import { refreshHoldingPrices } from "./refreshHoldingPrices";

vi.mock("@/lib/services/marketlens", () => ({
  fetchQuotes: vi.fn(),
  isMarketLensConfigured: vi.fn(),
}));

vi.mock("@/lib/security/providerKeys", () => ({ readProviderKeys: vi.fn() }));

function prismaMock(
  holdings = [
    {
      id: "holding-1",
      symbol: "AAPL",
      lastPriceMinor: 10_000,
      priceCurrency: "USD",
      account: { type: "RRSP" },
    },
  ],
) {
  return {
    holding: {
      findMany: vi.fn().mockResolvedValue(holdings),
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

  it("keeps same-symbol equity and crypto quotes inside their asset classes", async () => {
    const prisma = prismaMock([
      {
        id: "equity-btc",
        symbol: "BTC",
        lastPriceMinor: 1,
        priceCurrency: "USD",
        account: { type: "RRSP" },
      },
      {
        id: "crypto-btc",
        symbol: "BTC",
        lastPriceMinor: 1,
        priceCurrency: "CAD",
        account: { type: "CRYPTO" },
      },
    ]);
    vi.mocked(fetchQuotes)
      .mockResolvedValueOnce({
        ...quoteBatch("2026-08-18", "2026-08-18"),
        quotes: [
          {
            ...quoteBatch("2026-08-18", "2026-08-18").quotes[0],
            symbol: "BTC",
            close: 100,
            currency: "USD",
          },
        ],
      })
      .mockResolvedValueOnce({
        ...quoteBatch("2026-08-20", "2026-08-20"),
        quotes: [
          {
            ...quoteBatch("2026-08-20", "2026-08-20").quotes[0],
            symbol: "BTC",
            close: 50,
            currency: "CAD",
            source: "BINANCE",
          },
        ],
      });

    const result = await refreshHoldingPrices(prisma as never, "user-1");

    expect(prisma.holding.update).toHaveBeenNthCalledWith(1, {
      where: { id: "equity-btc" },
      data: expect.objectContaining({ lastPriceMinor: 10_000, priceCurrency: "USD" }),
    });
    expect(prisma.holding.update).toHaveBeenNthCalledWith(2, {
      where: { id: "crypto-btc" },
      data: expect.objectContaining({ lastPriceMinor: 5_000, priceCurrency: "CAD" }),
    });
    expect(result.validatedHoldingIds).toEqual(["equity-btc", "crypto-btc"]);
  });
});
