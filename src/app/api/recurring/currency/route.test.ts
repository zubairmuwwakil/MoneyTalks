import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";
import { confirmMerchantCurrency } from "@/lib/domain/recurring/confirmMerchantCurrency";
import { sweepRecurringObligations } from "@/lib/domain/recurring/detectRecurring";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/domain/recurring/confirmMerchantCurrency", () => ({ confirmMerchantCurrency: vi.fn() }));
vi.mock("@/lib/domain/recurring/detectRecurring", () => ({ sweepRecurringObligations: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    purchase: { findFirst: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
  },
}));

function request(body: unknown) {
  return new Request("http://localhost/api/recurring/currency", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/recurring/currency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.purchase.findFirst).mockResolvedValue({ id: "heroku-1" } as never);
    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue({ timezone: "America/Toronto" } as never);
    vi.mocked(confirmMerchantCurrency).mockResolvedValue({ affectedPurchases: 3 });
    vi.mocked(sweepRecurringObligations).mockResolvedValue({ created: 1, updated: 0, unchanged: 0, skipped: 0 });
  });

  it("scopes the teaching request to the current owner and re-sweeps", async () => {
    const response = await PATCH(request({ merchantCanonicalId: "heroku.com", currency: "usd" }) as never);

    await expect(response.json()).resolves.toEqual({ ok: true, affectedPurchases: 3 });
    expect(prisma.purchase.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", merchant: "heroku.com", totalCents: { not: null }, currency: null },
      select: { id: true },
    });
    expect(confirmMerchantCurrency).toHaveBeenCalledWith(prisma, {
      userId: "user-1", merchantCanonicalId: "heroku.com", currency: "USD",
    });
    expect(sweepRecurringObligations).toHaveBeenCalledWith(prisma, {
      userId: "user-1", timeZone: "America/Toronto", algorithmVersion: 1,
    });
  });

  it("does not teach a merchant that has no unresolved purchase for this owner", async () => {
    vi.mocked(prisma.purchase.findFirst).mockResolvedValue(null);

    const response = await PATCH(request({ merchantCanonicalId: "heroku.com", currency: "USD" }) as never);

    expect(response.status).toBe(404);
    expect(confirmMerchantCurrency).not.toHaveBeenCalled();
  });
});
