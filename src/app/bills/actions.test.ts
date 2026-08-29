import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocateRecommendedCard, createBill, setBillCadence, setBillPaymentRail, setBillRoute, updateBillPayeeDetails } from "./actions";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/require-user", () => ({ requireUserId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/domain/ownerState", () => ({
  ensureOwnerStateRecord: vi.fn(),
  defaultOwnerState: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bill: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    creditCard: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    fxRate: {
      findMany: vi.fn(),
    },
  },
}));

import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";

describe("allocateRecommendedCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(ensureOwnerStateRecord).mockResolvedValue({
      id: "owner-1",
      userId: "user-1",
      stateData: {
        ownerStateVersion: "default-1",
        ownedCardIds: ["mbna-rewards-we"],
        defaultCardId: "mbna-rewards-we",
        switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
        carry: { drawerCards: [] },
        cardStates: {},
        valuationsCad: {
          amexMembershipRewards: { centsPerPoint: 1, floorCentsPerPoint: 1, basis: "default cash floor" },
          marriottBonvoy: { centsPerPoint: 0.8, low: 0.6, high: 1.0, basis: "default" },
          mbnaRewards: { centsPerPoint: 1, floorCentsPerPoint: 0.833333, basis: "default cash floor" },
          ctMoney: { cadPerUnit: 1, optionalUsabilityFactor: 0.95, usabilityFactorApplied: true },
          cro: { model: "reward-currency", faceValueFactorIfAutoSold: 1, defaultHeldRiskFactor: 0.8 },
          cashBack: { cadPerDollar: 1 },
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.fxRate.findMany).mockResolvedValue([]);
    vi.mocked(prisma.bill.findFirst).mockResolvedValue({
      id: "bill-1",
      userId: "user-1",
      name: "Internet",
      category: "utilities",
      currency: "CAD",
      autopay: true,
      variable: false,
      spendCategory: null,
      cadence: { type: "MONTHLY", dayOfMonth: 1 },
      schedule: [{ from: "2020-01-01", amountMinor: 7500 }],
    } as never);
  });

  it("allocates existing linked card directly", async () => {
    vi.mocked(prisma.creditCard.findFirst).mockResolvedValueOnce({
      id: "card-123",
      contractCardId: "mbna-rewards-we",
    } as never);
    vi.mocked(prisma.bill.update).mockResolvedValue({ id: "bill-1", paymentCardId: "card-123" } as never);

    const formData = new FormData();
    formData.set("billId", "bill-1");

    const result = await allocateRecommendedCard(formData);
    expect(result).toEqual({ ok: true });
    expect(prisma.bill.update).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      data: { paymentCardId: "card-123" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/bills");
    expect(revalidatePath).toHaveBeenCalledWith("/bills/bill-1");
  });

  it("auto-links unlinked card when nickname matches the recommended card name", async () => {
    // 1st call (by contractCardId) -> null
    vi.mocked(prisma.creditCard.findFirst)
      .mockResolvedValueOnce(null)
      // 2nd call (by nickname match) -> returns matching unlinked card
      .mockResolvedValueOnce({
        id: "card-unlinked-1",
        contractCardId: null,
      } as never);

    vi.mocked(prisma.creditCard.update).mockResolvedValue({ id: "card-unlinked-1" } as never);
    vi.mocked(prisma.bill.update).mockResolvedValue({ id: "bill-1", paymentCardId: "card-unlinked-1" } as never);

    const formData = new FormData();
    formData.set("billId", "bill-1");

    const result = await allocateRecommendedCard(formData);
    expect(result).toEqual({ ok: true });
    expect(prisma.creditCard.update).toHaveBeenCalledWith({
      where: { id: "card-unlinked-1" },
      data: { contractCardId: "mbna-rewards-we" },
    });
    expect(prisma.bill.update).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      data: { paymentCardId: "card-unlinked-1" },
    });
  });

  it("auto-provisions credit card when user has no matching record in database", async () => {
    // 1st call (by contractCardId) -> null
    // 2nd call (by nickname) -> null
    vi.mocked(prisma.creditCard.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.creditCard.create).mockResolvedValueOnce({
      id: "card-new-1",
    } as never);
    vi.mocked(prisma.bill.update).mockResolvedValue({ id: "bill-1", paymentCardId: "card-new-1" } as never);

    const formData = new FormData();
    formData.set("billId", "bill-1");

    const result = await allocateRecommendedCard(formData);
    expect(result).toEqual({ ok: true });
    expect(prisma.creditCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          contractCardId: "mbna-rewards-we",
          nickname: "MBNA Rewards World Elite Mastercard",
        }),
      }),
    );
    expect(prisma.bill.update).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      data: { paymentCardId: "card-new-1" },
    });
  });

  it("returns error for excluded categories like housing", async () => {
    vi.mocked(prisma.bill.findFirst).mockResolvedValue({
      id: "bill-rent",
      userId: "user-1",
      name: "Rent",
      category: "housing",
      currency: "CAD",
      autopay: true,
      variable: false,
      spendCategory: null,
      cadence: { type: "MONTHLY", dayOfMonth: 1 },
      schedule: [{ from: "2020-01-01", amountMinor: 200000 }],
    } as never);

    const formData = new FormData();
    formData.set("billId", "bill-rent");

    const result = await allocateRecommendedCard(formData);
    expect(result).toEqual({ ok: false, error: "No recommendation is available for this bill yet." });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });
});

describe("setBillRoute", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(ensureOwnerStateRecord).mockResolvedValue({
      id: "owner-1",
      userId: "user-1",
      stateData: {
        ownerStateVersion: "default-1",
        ownedCardIds: ["scotia-momentum-vi-plus"],
        defaultCardId: "scotia-momentum-vi-plus",
        switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
        carry: { drawerCards: [] },
        cardStates: {},
        valuationsCad: {
          cashBack: { cadPerDollar: 1 },
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.bill.findFirst).mockResolvedValue({
      id: "bill-1",
      userId: "user-1",
      name: "Water bill",
      payee: "Toronto Hydro",
      schedule: [{ from: "2026-01-01", amountMinor: 15000 }],
    } as never);
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([{
      id: "wallet-card-1",
      nickname: "My Momentum",
      contractCardId: "scotia-momentum-vi-plus",
    }] as never);
    vi.mocked(prisma.bill.update).mockResolvedValue({} as never);
  });

  it("persists a contract route and resolves its card back to the live wallet row", async () => {
    const fd = new FormData();
    fd.set("billId", "bill-1");
    fd.set("selectedRouteId", "chexy:scotia-momentum-vi-plus");

    const result = await setBillRoute(fd);

    expect(result).toEqual({ ok: true });
    expect(prisma.bill.update).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      data: {
        selectedRouteId: "chexy:scotia-momentum-vi-plus",
        selectedRouteIntermediaryId: "chexy",
        paymentCardId: "wallet-card-1",
        paymentRail: "card_via_third_party",
        railFeePct: 1.75,
      },
    });
  });

  it("refuses a route that is not available in the current wallet", async () => {
    const fd = new FormData();
    fd.set("billId", "bill-1");
    fd.set("selectedRouteId", "triangle-bill-pay:triangle-we");

    const result = await setBillRoute(fd);

    expect(result).toEqual({ ok: false, error: "That payment route is no longer available in your wallet." });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });
});

describe("createBill route persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.bill.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.bill.create).mockResolvedValue({ id: "bill-new" } as never);
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([{
      id: "wallet-card-1",
      nickname: "My Momentum",
      contractCardId: "scotia-momentum-vi-plus",
    }] as never);
    vi.mocked(ensureOwnerStateRecord).mockResolvedValue({
      id: "owner-1",
      userId: "user-1",
      stateData: {
        ownerStateVersion: "default-1",
        ownedCardIds: ["scotia-momentum-vi-plus"],
        defaultCardId: "scotia-momentum-vi-plus",
        switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
        carry: { drawerCards: [] },
        cardStates: {},
        valuationsCad: { cashBack: { cadPerDollar: 1 } },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  });

  it("stores the new payee and its server-validated selected route together", async () => {
    const fd = new FormData();
    fd.set("name", "Home hydro");
    fd.set("payee", "Toronto Hydro");
    fd.set("category", "utilities");
    fd.set("currency", "CAD");
    fd.set("paymentRail", "unknown");
    fd.set("cadenceJson", JSON.stringify({ type: "MONTHLY", dayOfMonth: 1 }));
    fd.set("scheduleJson", JSON.stringify([{ from: "2026-08-01", amount: "150" }]));
    fd.set("selectedRouteId", "chexy:scotia-momentum-vi-plus");

    const result = await createBill(fd);

    expect(result).toEqual({ ok: true });
    expect(prisma.bill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        name: "Home hydro",
        payee: "Toronto Hydro",
        selectedRouteId: "chexy:scotia-momentum-vi-plus",
        selectedRouteIntermediaryId: "chexy",
        paymentCardId: "wallet-card-1",
        paymentRail: "card_via_third_party",
        railFeePct: 1.75,
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/bills");
  });
});

describe("setBillPaymentRail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.bill.findFirst).mockResolvedValue({ id: "bill-1", userId: "user-1" } as never);
    vi.mocked(prisma.bill.update).mockResolvedValue({} as never);
  });

  function form(fields: Record<string, string>) {
    const fd = new FormData();
    fd.set("billId", "bill-1");
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("persists a bank-debit-only rail", async () => {
    const result = await setBillPaymentRail(form({ paymentRail: "pad" }));
    expect(result.ok).toBe(true);
    expect(vi.mocked(prisma.bill.update).mock.calls[0][0]).toMatchObject({
      where: { id: "bill-1" },
      data: { paymentRail: "pad", railFeePct: null },
    });
  });

  it("persists a third-party rail together with its fee", async () => {
    const result = await setBillPaymentRail(form({ paymentRail: "card_via_third_party", railFeePct: "2.5" }));
    expect(result.ok).toBe(true);
    expect(vi.mocked(prisma.bill.update).mock.calls[0][0]).toMatchObject({
      data: { paymentRail: "card_via_third_party", railFeePct: 2.5 },
    });
  });

  it("clears a stale fee when the rail no longer charges one", async () => {
    await setBillPaymentRail(form({ paymentRail: "card", railFeePct: "2.5" }));
    expect(vi.mocked(prisma.bill.update).mock.calls[0][0]).toMatchObject({
      data: { paymentRail: "card", railFeePct: null },
    });
  });

  it("stores a third-party rail with no fee rather than rejecting it — the panel explains what is missing", async () => {
    const result = await setBillPaymentRail(form({ paymentRail: "card_via_third_party", railFeePct: "" }));
    expect(result.ok).toBe(true);
    expect(vi.mocked(prisma.bill.update).mock.calls[0][0]).toMatchObject({
      data: { paymentRail: "card_via_third_party", railFeePct: null },
    });
  });

  it("refuses a rail outside the known vocabulary and writes nothing", async () => {
    const result = await setBillPaymentRail(form({ paymentRail: "interac" }));
    expect(result.ok).toBe(false);
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });
});

describe("setBillCadence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.bill.findFirst).mockResolvedValue({ id: "bill-1", userId: "user-1" } as never);
    vi.mocked(prisma.bill.update).mockResolvedValue({} as never);
  });

  it("updates monthly cadence with day of month via cadenceJson", async () => {
    const fd = new FormData();
    fd.set("billId", "bill-1");
    fd.set("cadenceJson", JSON.stringify({ type: "MONTHLY", dayOfMonth: 18 }));

    const result = await setBillCadence(fd);
    expect(result).toEqual({ ok: true });
    expect(prisma.bill.update).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      data: { cadence: { type: "MONTHLY", dayOfMonth: 18 } },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/bills/bill-1");
    expect(revalidatePath).toHaveBeenCalledWith("/bills");
    expect(revalidatePath).toHaveBeenCalledWith("/bills/forecast");
    expect(revalidatePath).toHaveBeenCalledWith("/bills/month");
  });

  it("updates biweekly cadence with anchor date", async () => {
    const fd = new FormData();
    fd.set("billId", "bill-1");
    fd.set("cadenceJson", JSON.stringify({ type: "BIWEEKLY", anchor: "2026-08-18" }));

    const result = await setBillCadence(fd);
    expect(result).toEqual({ ok: true });
    expect(prisma.bill.update).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      data: { cadence: { type: "BIWEEKLY", anchor: "2026-08-18" } },
    });
  });

  it("rejects invalid day of month (> 31)", async () => {
    const fd = new FormData();
    fd.set("billId", "bill-1");
    fd.set("cadenceJson", JSON.stringify({ type: "MONTHLY", dayOfMonth: 32 }));

    const result = await setBillCadence(fd);
    expect(result.ok).toBe(false);
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });
});

describe("updateBillPayeeDetails", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.bill.findFirst).mockResolvedValue({ id: "bill-1", userId: "user-1" } as never);
    vi.mocked(prisma.bill.update).mockResolvedValue({} as never);
  });

  it("updates payee details and persists granular taxonomy category", async () => {
    const fd = new FormData();
    fd.set("billId", "bill-1");
    fd.set("name", "Netflix 4K");
    fd.set("payee", "Netflix Canada");
    fd.set("accountNumber", "NET-9912");
    fd.set("category", "subscriptions:streaming");
    fd.set("notes", "Shared family plan");

    const result = await updateBillPayeeDetails(fd);
    expect(result).toEqual({ ok: true });
    expect(prisma.bill.update).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      data: {
        name: "Netflix 4K",
        payee: "Netflix Canada",
        accountNumber: "NET-9912",
        category: "subscriptions:streaming",
        notes: "Shared family plan",
      },
    });
  });
});
