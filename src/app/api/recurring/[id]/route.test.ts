import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";
import { sweepRecurringObligations } from "@/lib/domain/recurring/detectRecurring";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/domain/recurring/detectRecurring", () => ({ sweepRecurringObligations: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    recurringObligation: { findFirst: vi.fn(), deleteMany: vi.fn() },
    recurringObligationEvidence: { updateMany: vi.fn() },
    merchantCurrencyConfirmation: { upsert: vi.fn() },
    purchase: { updateManyAndReturn: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
  },
}));

const context = { params: Promise.resolve({ id: "obligation-1" }) };
function request(body: unknown) {
  return new Request("http://localhost/api/recurring/obligation-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/recurring/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "obligation-1" }]);
    vi.mocked(prisma.recurringObligation.findFirst).mockResolvedValue({ id: "obligation-1" } as never);
    vi.mocked(prisma.recurringObligationEvidence.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.$transaction).mockImplementation(async (operation) => operation(prisma));
    vi.mocked(prisma.merchantCurrencyConfirmation.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.purchase.updateManyAndReturn).mockResolvedValue([]);
    vi.mocked(prisma.recurringObligation.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue({ timezone: "America/Toronto" } as never);
    vi.mocked(sweepRecurringObligations).mockResolvedValue({ created: 0, updated: 0, unchanged: 0, skipped: 0 });
  });

  it("rejects dismissal without a reason instead of storing a null label", async () => {
    const response = await PATCH(request({ action: "dismiss" }) as never, context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "A dismissal reason is required" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("dismisses with an owner-scoped mutation and snapshots the deciding score", async () => {
    const response = await PATCH(request({ action: "dismiss", dismissReason: "not-recurring" }) as never, context);

    expect(response.status).toBe(200);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    const query = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as { strings: string[]; values: unknown[] };
    const sql = query.strings.join("?");
    expect(sql).toContain('"userId" = ?');
    expect(sql).toContain('"decidedConfidence" = confidence');
    expect(sql).toContain('"decidedReasons" = "confidenceReasons"');
    expect(query.values).toEqual(expect.arrayContaining(["obligation-1", "user-1", "not-recurring"]));
  });

  it("confirms once without allowing a later action to overwrite the snapshot", async () => {
    await PATCH(request({ action: "confirm" }) as never, context);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const second = await PATCH(request({ action: "dismiss", dismissReason: "not-recurring" }) as never, context);

    await expect(second.json()).resolves.toEqual({ ok: true, alreadyHandled: true });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("scopes evidence exclusion through the obligation owner", async () => {
    await PATCH(request({ action: "exclude-evidence", evidenceId: "evidence-1" }) as never, context);

    expect(prisma.recurringObligationEvidence.updateMany).toHaveBeenCalledWith({
      where: {
        id: "evidence-1",
        obligationId: "obligation-1",
        obligation: { userId: "user-1" },
      },
      data: { excludedByUser: true },
    });
  });

  it("returns not found when the owner-scoped lookup cannot see the obligation", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.recurringObligation.findFirst).mockResolvedValue(null);
    const response = await PATCH(request({ action: "confirm" }) as never, context);
    expect(response.status).toBe(404);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it("teaches currency only for this owner and re-resolves only unresolved merchant purchases", async () => {
    vi.mocked(prisma.recurringObligation.findFirst).mockResolvedValue({ merchantCanonicalId: "heroku.com" } as never);
    vi.mocked(prisma.purchase.updateManyAndReturn).mockResolvedValue([{ id: "purchase-1" }, { id: "purchase-2" }] as never);

    const response = await PATCH(request({ action: "set-currency", currency: "usd" }) as never, context);

    await expect(response.json()).resolves.toEqual({ ok: true, affectedPurchases: 2 });
    expect(prisma.merchantCurrencyConfirmation.upsert).toHaveBeenCalledWith({
      where: { userId_merchantCanonicalId: { userId: "user-1", merchantCanonicalId: "heroku.com" } },
      create: { userId: "user-1", merchantCanonicalId: "heroku.com", currency: "USD" },
      update: { currency: "USD" },
    });
    expect(prisma.purchase.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        merchant: "heroku.com",
        OR: [
          { currencySource: null },
          { currencySource: "none" },
          { currencySource: "ownerConfirmedForMerchant" },
        ],
      },
      data: { currency: "USD", currencySource: "ownerConfirmedForMerchant" },
      select: { id: true },
    });
    expect(sweepRecurringObligations).toHaveBeenCalledWith(prisma, {
      userId: "user-1", timeZone: "America/Toronto", algorithmVersion: 1,
    });
  });
});
