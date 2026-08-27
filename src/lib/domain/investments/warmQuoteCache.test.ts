import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQuotes, isMarketLensConfigured } from "@/lib/services/marketlens";
import { warmQuoteCache } from "./warmQuoteCache";

vi.mock("@/lib/services/marketlens", () => ({
  fetchQuotes: vi.fn(),
  isMarketLensConfigured: vi.fn(),
}));

function prismaMock(
  holdings = [
    { symbol: "AAPL", account: { type: "RRSP" } },
    { symbol: "aapl", account: { type: "TFSA" } },
    { symbol: "BTC", account: { type: "CRYPTO" } },
  ],
) {
  return { holding: { findMany: vi.fn().mockResolvedValue(holdings) } };
}

const quote = (symbol: string, status: string, reason: string | null = null) => ({
  symbol, status, close: 1, currency: "USD", tradeDate: "2026-08-26",
  source: "YAHOO", keySource: "NONE", staleTradingDays: 0, reason,
});

const batch = (quotes: unknown[]) => ({
  pricing: "daily-close", expectedSession: "2026-08-26", truncated: [], quotes,
});

/**
 * The warm-up's contract: make MarketLens' cache correct for the symbols this app
 * is about to read, and say plainly whether it managed to.
 *
 * It warms only our own symbols, through the ordinary quotes endpoint. MarketLens'
 * global sweep sits behind /api/v1/admin/** and needs an ADMIN role this app's key
 * does not carry — and warming symbols nobody here holds is not this job's business.
 */
describe("warmQuoteCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMarketLensConfigured).mockReturnValue(true);
  });

  it("forces a provider fan-out for every distinct symbol, split by asset class", async () => {
    vi.mocked(fetchQuotes)
      .mockResolvedValueOnce(batch([quote("AAPL", "FRESH")]) as never)
      .mockResolvedValueOnce(batch([quote("BTC", "FRESH")]) as never);

    const report = await warmQuoteCache(prismaMock() as never);

    expect(fetchQuotes).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchQuotes).mock.calls[0][0]).toEqual(["AAPL"]);
    expect(vi.mocked(fetchQuotes).mock.calls[0][1]).toMatchObject({
      assetClass: "EQUITY", refresh: true,
    });
    expect(vi.mocked(fetchQuotes).mock.calls[1][1]).toMatchObject({
      assetClass: "CRYPTO", refresh: true,
    });
    expect(report).toMatchObject({ ok: true, symbols: 2, fresh: 2 });
  });

  it("reports not ok and carries MarketLens' causes when a symbol stays stale", async () => {
    // The cause is the point. "Nothing worked" is not actionable;
    // "provider_deadline_exceeded x2" tells you exactly which knob to turn.
    vi.mocked(fetchQuotes).mockResolvedValue(
      batch([
        quote("AAPL", "FRESH"),
        quote("VFV.TO", "STALE", "provider_deadline_exceeded"),
      ]) as never,
    );

    const report = await warmQuoteCache(
      prismaMock([
        { symbol: "AAPL", account: { type: "RRSP" } },
        { symbol: "VFV.TO", account: { type: "RRSP" } },
      ]) as never,
    );

    expect(report.ok).toBe(false);
    expect(report.causes).toEqual({ provider_deadline_exceeded: 1 });
  });

  it("reports unreachable when MarketLens answers nothing at all", async () => {
    vi.mocked(fetchQuotes).mockResolvedValue(null);

    const report = await warmQuoteCache(
      prismaMock([{ symbol: "AAPL", account: { type: "RRSP" } }]) as never,
    );

    expect(report).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("treats having nothing to warm as healthy, not as a failure", async () => {
    const report = await warmQuoteCache(prismaMock([]) as never);

    expect(report).toMatchObject({ ok: true, symbols: 0, reason: "no-symbols" });
    expect(fetchQuotes).not.toHaveBeenCalled();
  });

  it("does not pretend to have warmed anything when MarketLens is unconfigured", async () => {
    vi.mocked(isMarketLensConfigured).mockReturnValue(false);

    const report = await warmQuoteCache(prismaMock() as never);

    expect(report).toMatchObject({ ok: false, reason: "not-configured" });
    expect(fetchQuotes).not.toHaveBeenCalled();
  });
});
