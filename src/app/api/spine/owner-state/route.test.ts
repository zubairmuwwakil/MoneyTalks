import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { ownerStateRecord: { upsert: vi.fn() } } }));

const state = {
  ownerStateVersion: "wallet-setup-1", ownedCardIds: ["amex-cobalt"], defaultCardId: "amex-cobalt",
  switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
  carry: { drawerCards: [] }, cardStates: { "amex-cobalt": { capProgress: { cap: 0 } } },
  valuationsCad: {
    amexMembershipRewards: { centsPerPoint: 1, floorCentsPerPoint: 1 },
    marriottBonvoy: { centsPerPoint: 0.8, low: 0.6, high: 1 },
    mbnaRewards: { centsPerPoint: 1, floorCentsPerPoint: 0.833333 },
    ctMoney: { cadPerUnit: 1, optionalUsabilityFactor: 0.95, usabilityFactorApplied: true },
    cro: { model: "reward-currency", faceValueFactorIfAutoSold: 1, defaultHeldRiskFactor: 0.8 },
    cashBack: { cadPerDollar: 1 },
  },
};

describe("PUT /api/spine/owner-state", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(getSessionUserId).mockResolvedValue("user-1"); });

  it("requires a Clerk session", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    expect((await PUT(new NextRequest("http://localhost/api/spine/owner-state", { method: "PUT", body: JSON.stringify(state) }))).status).toBe(401);
  });

  it("rejects a state whose default card is not owned", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/spine/owner-state", {
      method: "PUT", body: JSON.stringify({ ...state, defaultCardId: "not-owned" }),
    }));
    expect(response.status).toBe(400);
    expect(prisma.ownerStateRecord.upsert).not.toHaveBeenCalled();
  });

  it("upserts the validated signed-in user's state", async () => {
    vi.mocked(prisma.ownerStateRecord.upsert).mockResolvedValue({ stateData: state, updatedAt: new Date("2026-08-17T12:00:00Z") } as never);
    const response = await PUT(new NextRequest("http://localhost/api/spine/owner-state", { method: "PUT", body: JSON.stringify(state) }));
    expect(response.status).toBe(200);
    expect(prisma.ownerStateRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" }, create: expect.objectContaining({ userId: "user-1" }),
    }));
  });
});
