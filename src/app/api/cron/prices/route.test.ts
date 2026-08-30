import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { refreshHoldingPrices } from "@/lib/domain/investments/refreshHoldingPrices";
import { captureInvestmentSnapshots } from "@/lib/domain/investments/captureInvestmentSnapshots";
import { warmQuoteCache } from "@/lib/domain/investments/warmQuoteCache";

vi.mock("@/lib/security/cronAuth", () => ({
  isAuthorizedCronRequest: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/services/marketlens", () => ({
  isMarketLensConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/domain/investments/warmQuoteCache", () => ({ warmQuoteCache: vi.fn() }));

vi.mock("@/lib/services/alerting", () => ({ sendServiceFailureAlert: vi.fn() }));

vi.mock("@/lib/domain/investments/refreshHoldingPrices", () => ({
  refreshHoldingPrices: vi.fn(),
}));

vi.mock("@/lib/domain/investments/captureInvestmentSnapshots", () => ({
  captureInvestmentSnapshots: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
  },
}));

function request(): never {
  return new Request("https://example.test/api/cron/prices") as never;
}

describe("price cron performance capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(warmQuoteCache).mockResolvedValue({
      ok: true, symbols: 2, fresh: 2, stale: 0, causes: {},
    });
    vi.mocked(refreshHoldingPrices).mockResolvedValue({
      ok: true,
      updated: 2,
      skipped: [],
      validatedHoldingIds: ["holding-1", "holding-2"],
      sources: { YAHOO: 2 },
    });
    vi.mocked(captureInvestmentSnapshots).mockResolvedValue({
      accounts: 1,
      complete: 1,
      partial: 0,
      failed: 0,
      failures: [],
    });
  });

  it("selects every user with an account and skips quote refresh for cash-only users", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "cash-user", financialAccounts: [{ holdings: [] }] },
    ] as never);

    const response = await GET(request());

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { financialAccounts: { some: {} } },
      orderBy: { id: "asc" },
      take: 25,
      select: {
        id: true,
        financialAccounts: { select: { holdings: { select: { id: true }, take: 1 } } },
      },
    });
    expect(refreshHoldingPrices).not.toHaveBeenCalled();
    expect(captureInvestmentSnapshots).toHaveBeenCalledWith(prisma, "cash-user", {
      validatedHoldingIds: [],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      users: 1,
      usersRefreshed: 0,
      updated: 0,
      snapshots: { complete: 1, partial: 0, failed: 0 },
    });
  });

  it("captures after each quote attempt and continues when one user's refresh fails", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "one", financialAccounts: [{ holdings: [{ id: "holding-1" }] }] },
      { id: "two", financialAccounts: [{ holdings: [{ id: "holding-2" }] }] },
    ] as never);
    vi.mocked(refreshHoldingPrices)
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({
        ok: true,
        updated: 3,
        skipped: [],
        validatedHoldingIds: ["holding-2"],
        sources: { YAHOO: 3 },
      });
    vi.mocked(captureInvestmentSnapshots)
      .mockResolvedValueOnce({ accounts: 1, complete: 0, partial: 1, failed: 0, failures: [] })
      .mockResolvedValueOnce({ accounts: 1, complete: 1, partial: 0, failed: 0, failures: [] });

    const response = await GET(request());

    expect(refreshHoldingPrices).toHaveBeenCalledTimes(2);
    expect(captureInvestmentSnapshots).toHaveBeenNthCalledWith(1, prisma, "one", {
      validatedHoldingIds: [],
    });
    expect(captureInvestmentSnapshots).toHaveBeenNthCalledWith(2, prisma, "two", {
      validatedHoldingIds: ["holding-2"],
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      users: 2,
      usersRefreshed: 1,
      updated: 3,
      snapshots: { complete: 1, partial: 1, failed: 0 },
    });
  });

  it("returns an error when no user's snapshot attempt stores a valuation", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "one", financialAccounts: [{ holdings: [] }] },
      { id: "two", financialAccounts: [{ holdings: [] }] },
    ] as never);
    vi.mocked(captureInvestmentSnapshots).mockRejectedValue(new Error("database unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "no-snapshots-recorded",
      users: 2,
      snapshots: { complete: 0, partial: 0, failed: 2 },
    });
  });

  it("warms the provider path itself before reading it, in case the warm-up cron did not", async () => {
    // Belt and braces across a process boundary. The 01:45 warm-up is the primary
    // mechanism, but it can be retried into failure, skipped on a deploy, or
    // silently unscheduled. Reading a cold cache and recording the result as a
    // valuation is precisely the failure being designed out, so this job refuses
    // to read a cache it did not first ask someone to correct.
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "one", financialAccounts: [{ holdings: [{ id: "holding-1" }] }] },
    ] as never);

    await GET(request());

    expect(warmQuoteCache).toHaveBeenCalledOnce();
    expect(vi.mocked(warmQuoteCache).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(refreshHoldingPrices).mock.invocationCallOrder[0]);
  });

  it("still records a valuation when the warm sweep fails, rather than skipping the night", async () => {
    // E4: a refresh that learns nothing changes nothing — but it must not also
    // prevent the snapshot. A stale-but-recorded, honestly-labelled valuation beats
    // a missing one.
    vi.mocked(warmQuoteCache).mockResolvedValue({
      ok: false, symbols: 2, fresh: 0, stale: 2,
      causes: { provider_deadline_exceeded: 2 },
    });
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "one", financialAccounts: [{ holdings: [{ id: "holding-1" }] }] },
    ] as never);

    const response = await GET(request());

    expect(refreshHoldingPrices).toHaveBeenCalledOnce();
    expect(captureInvestmentSnapshots).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });
});
