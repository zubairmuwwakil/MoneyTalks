import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocateRecommendedCard, setBillPaymentRail } from "./actions";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { revalidatePath } from "next/cache";
import { defaultOwnerState } from "@/lib/domain/ownerState";

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
      update: vi.fn(),
    },
    creditCard: {
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
