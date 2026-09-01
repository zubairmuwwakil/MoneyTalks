import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PUT } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ownerStateRecord: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    creditCard: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), deleteMany: vi.fn() },
  },
}));

const valuations = {
  amexMembershipRewards: { centsPerPoint: 1, floorCentsPerPoint: 1 },
  marriottBonvoy: { centsPerPoint: 0.8, low: 0.6, high: 1 },
  mbnaRewards: { centsPerPoint: 1, floorCentsPerPoint: 0.833333 },
  ctMoney: { cadPerUnit: 1, optionalUsabilityFactor: 0.95, usabilityFactorApplied: true },
  cro: { model: "reward-currency", faceValueFactorIfAutoSold: 1, defaultHeldRiskFactor: 0.8 },
  cashBack: { cadPerDollar: 1 },
};

const state = {
  ownerStateVersion: "wallet-setup-1", ownedCardIds: ["amex-cobalt"], defaultCardId: "amex-cobalt",
  switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
  carry: { drawerCards: [] }, cardStates: { "amex-cobalt": { capProgress: { cap: 0 } } },
  valuationsCad: valuations,
};

const modernPrograms = {
  amexMembershipRewards: { model: "points", centsPerPoint: 1, floorCentsPerPoint: 1 },
  marriottBonvoy: { model: "points", centsPerPoint: 0.8, low: 0.6, high: 1 },
  mbnaRewards: { model: "points", centsPerPoint: 1, floorCentsPerPoint: 0.833333 },
  ctMoney: { model: "ctMoney", cadPerUnit: 1, optionalUsabilityFactor: 0.95, usabilityFactorApplied: true },
  cro: {
    model: "cro", redemptionModel: "reward-currency",
    faceValueFactorIfAutoSold: 1, defaultHeldRiskFactor: 0.8,
  },
  cashback: { model: "cashback", cadPerDollar: 1 },
  aeroplan: { model: "points", centsPerPoint: 1.5 },
  noRewards: { model: "noRewards", basis: "Zero earn card" },
  costcoCashRewards: {
    model: "merchantCredit",
    cadPerUnit: 1,
    optionalUsabilityFactor: 0.95,
    usabilityFactorApplied: true,
    merchantScope: ["costco"],
  },
};

const modernState = { ...state, valuationsCad: { programs: modernPrograms } };

const put = (body: unknown) =>
  PUT(new NextRequest("http://localhost/api/spine/owner-state", { method: "PUT", body: JSON.stringify(body) }));

const stored = (stateData: unknown, updatedAt = new Date("2026-08-17T12:00:00Z")) =>
  ({ userId: "user-1", stateData, updatedAt } as never);

describe("PUT /api/spine/owner-state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
  });

  it("requires a Clerk session", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    expect((await put(state)).status).toBe(401);
  });

  it("rejects a state whose default card is not owned", async () => {
    const response = await put({ ...state, defaultCardId: "not-owned" });
    expect(response.status).toBe(400);
    expect(prisma.ownerStateRecord.create).not.toHaveBeenCalled();
    expect(prisma.ownerStateRecord.updateMany).not.toHaveBeenCalled();
  });

  it("creates the record when the user has none", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(state));
    expect((await put(state)).status).toBe(200);
    expect(prisma.ownerStateRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1" }) }),
    );
  });

  // Before this fix, ownerStateInput's .strict() rejected any payload carrying `market` at all
  // (HTTP 400), so a US-resident owner's residency had no path to persist server-side.
  it("accepts and persists the owner's market", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    const usState = { ...state, market: "US" };
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(usState));

    expect((await put(usState)).status).toBe(200);
    expect(prisma.ownerStateRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stateData: expect.objectContaining({ market: "US" }) }) }),
    );
  });

  it("rejects an unrecognized market", async () => {
    const response = await put({ ...state, market: "MX" });
    expect(response.status).toBe(400);
  });

  // card-contracts@2.8 moved owner-condition answers into CardState.flags, keyed by the
  // catalogue's condition id. `.strict()` REJECTS unknown keys rather than stripping them, so
  // every wallet with an answered condition 400'd here — and because SyncCoordinator flushes
  // the queued owner state as the first statement of its sync, that 400 took caps, feedback,
  // card requests and wallet captures down with it, permanently, on every attempt.
  //
  // Keys are deliberately unconstrained. Validating them against the vendored
  // owner-conditions.json registry would 400 every answer to a condition PickMe shipped before
  // the hub re-vendored the contract — the same class of failure this test exists to close.
  it("accepts the flags dictionary PickMe writes owner-condition answers into", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    const withFlags = {
      ...state,
      cardStates: {
        "amex-cobalt": {
          capProgress: { cap: 0 },
          flags: { amazonEligiblePrimeLinked: true, cryptoLevelUpProActive: false },
        },
      },
    };
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(withFlags));

    expect((await put(withFlags)).status).toBe(200);

    const written = (vi.mocked(prisma.ownerStateRecord.create).mock.calls[0][0].data as {
      stateData: { cardStates: Record<string, { flags?: Record<string, boolean> }> };
    }).stateData;
    expect(written.cardStates["amex-cobalt"].flags)
      .toEqual({ amazonEligiblePrimeLinked: true, cryptoLevelUpProActive: false });
  });

  // A flag answer is a tri-state at the engine boundary: absent is unresolved and fails closed,
  // false is a real "no". A non-boolean would collapse that distinction, so it is refused rather
  // than coerced.
  it("rejects a non-boolean flag answer", async () => {
    const response = await put({
      ...state,
      cardStates: { "amex-cobalt": { flags: { cryptoLevelUpProActive: "yes" } } },
    });
    expect(response.status).toBe(400);
  });

  it("accepts the account date and aggregate credit state emitted by current PickMe builds", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    const creditPayload = {
      ...modernState,
      cardStates: {
        "amex-cobalt": {
          accountOpenedAt: "2024-03-15",
          creditStates: {
            "cobalt-streaming-annual": {
              enrollmentStatus: "enrolled",
              windows: {
                "calendar-year:2026": {
                  consumedAmount: 12.99,
                  realizedAmount: 12.99,
                  updatedAt: "2026-09-01",
                },
              },
              lastRedemptionAt: null,
            },
          },
        },
      },
    };
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(creditPayload));

    expect((await put(creditPayload)).status).toBe(200);
    expect(prisma.ownerStateRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stateData: expect.objectContaining({ cardStates: creditPayload.cardStates }),
        }),
      }),
    );
  });

  it("round-trips additive PickMe fields instead of rejecting the next mobile release", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    const futurePayload = {
      ...modernState,
      futureOwnerFact: { source: "PickMe" },
      cardStates: { "amex-cobalt": { futureCardFact: { enabled: true } } },
    };
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(futurePayload));

    expect((await put(futurePayload)).status).toBe(200);
    const written = vi.mocked(prisma.ownerStateRecord.create).mock.calls[0][0].data.stateData as {
      futureOwnerFact?: unknown;
      cardStates: Record<string, { futureCardFact?: unknown }>;
    };
    expect(written.futureOwnerFact).toEqual({ source: "PickMe" });
    expect(written.cardStates["amex-cobalt"].futureCardFact).toEqual({ enabled: true });
  });

  it("accepts PickMe's modern program dictionary without dropping newer programs", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(modernState));

    expect((await put(modernState)).status).toBe(200);

    const written = (vi.mocked(prisma.ownerStateRecord.create).mock.calls[0][0].data as {
      stateData: {
        valuationsCad: {
          programs: Record<string, unknown>;
          cro: { model: string };
          cashBack: { cadPerDollar: number };
        };
      };
    }).stateData.valuationsCad;
    expect(written.programs.aeroplan).toEqual(modernPrograms.aeroplan);
    expect(written.programs.noRewards).toEqual(modernPrograms.noRewards);
    expect(written.programs.costcoCashRewards).toEqual(modernPrograms.costcoCashRewards);
    expect(written.cro.model).toBe("reward-currency");
    expect(written.cashBack.cadPerDollar).toBe(1);
  });

  it("accepts a first-run wallet with empty programs and null fields", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(modernState));

    const firstRunPayload = {
      ownerStateVersion: "wallet-setup-1",
      ownedCardIds: ["cibc-dividend-visa-infinite"],
      defaultCardId: "cibc-dividend-visa-infinite",
      switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
      carry: { drawerCards: [] },
      cardStates: {
        "cibc-dividend-visa-infinite": {
          croHandling: null,
          scotiaAccountYearAnchorMonth: null,
          selectedCategories: null,
          flags: null,
        },
      },
      market: null,
      valuationsCad: {
        programs: {},
      },
    };

    expect((await put(firstRunPayload)).status).toBe(200);

    const createdCall = vi.mocked(prisma.ownerStateRecord.create).mock.calls.at(-1)![0].data as {
      stateData: {
        ownedCardIds: string[];
        cardStates: Record<string, unknown>;
        valuationsCad: {
          programs: Record<string, unknown>;
          amexMembershipRewards: { centsPerPoint: number };
        };
      };
    };
    expect(createdCall.stateData.valuationsCad.programs).toEqual({});
    expect(createdCall.stateData.valuationsCad.amexMembershipRewards.centsPerPoint).toBe(1);
  });

  it("accepts removal of the final card as a valid empty wallet", async () => {
    const emptyWallet = {
      ...modernState,
      ownedCardIds: [],
      deletedCardIds: ["amex-cobalt"],
      defaultCardId: "",
      cardStates: {},
    };
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.ownerStateRecord.create).mockResolvedValue(stored(emptyWallet));

    expect((await put(emptyWallet)).status).toBe(200);
    expect(prisma.ownerStateRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stateData: expect.objectContaining({ ownedCardIds: [], defaultCardId: "" }) }),
      }),
    );
  });

  it("rejects a non-empty default card when the wallet is empty", async () => {
    const response = await put({ ...modernState, ownedCardIds: [], defaultCardId: "amex-cobalt", cardStates: {} });
    expect(response.status).toBe(400);
  });

  // The regression this endpoint's merge exists for: PickMe saving its wallet
  // used to replace stateData wholesale, silently un-owning every card the
  // phone did not happen to have and discarding web-authored answers.
  it("merges into the stored wallet instead of replacing it", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique)
      .mockResolvedValueOnce(stored({
        ...state,
        ownedCardIds: ["amex-cobalt", "td-aeroplan-visa-infinite"],
        cardStates: { "tangerine-moneyback-world": { selectedCategories: ["groceries"] } },
      }))
      .mockResolvedValueOnce(stored(state, new Date("2026-08-19T12:00:00Z")));
    vi.mocked(prisma.ownerStateRecord.updateMany).mockResolvedValue({ count: 1 } as never);

    expect((await put(state)).status).toBe(200);

    const written = (vi.mocked(prisma.ownerStateRecord.updateMany).mock.calls[0][0].data as {
      stateData: { ownedCardIds: string[]; cardStates: Record<string, unknown> };
    }).stateData;
    expect(written.ownedCardIds).toEqual(["amex-cobalt", "td-aeroplan-visa-infinite"]);
    expect(written.cardStates["tangerine-moneyback-world"]).toEqual({ selectedCategories: ["groceries"] });
  });

  it("guards the write on the version it read", async () => {
    const readAt = new Date("2026-08-17T12:00:00Z");
    vi.mocked(prisma.ownerStateRecord.findUnique)
      .mockResolvedValueOnce(stored(state, readAt))
      .mockResolvedValueOnce(stored(state, readAt));
    vi.mocked(prisma.ownerStateRecord.updateMany).mockResolvedValue({ count: 1 } as never);
    await put(state);
    expect(prisma.ownerStateRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", updatedAt: readAt } }),
    );
  });

  it("re-reads and retries when another writer landed first", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(stored(state));
    vi.mocked(prisma.ownerStateRecord.updateMany)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    expect((await put(state)).status).toBe(200);
    expect(prisma.ownerStateRecord.updateMany).toHaveBeenCalledTimes(2);
  });

  it("reports a conflict rather than success when contention never clears", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(stored(state));
    vi.mocked(prisma.ownerStateRecord.updateMany).mockResolvedValue({ count: 0 } as never);
    expect((await put(state)).status).toBe(409);
  });
});

describe("GET /api/spine/owner-state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
  });

  it("requires a Clerk session", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  // A user with no catalogue-linked cards is a real answer, not a failure:
  // PickMe must show its own empty picker rather than an error.
  it("returns a null wallet rather than an error when there is nothing to send", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as never);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerState: null, updatedAt: null });
  });

  it("returns the stored wallet in PickMe's modern valuation shape", async () => {
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(stored(state));
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as never);
    const response = await GET();
    expect(response.status).toBe(200);
    const ownerState = (await response.json()).ownerState;
    expect(ownerState).toEqual({
      ...state,
      valuationsCad: { programs: modernProgramsWithoutAeroplan() },
    });
  });

  it("normalizes records that already use the renamed CRO redemption field", async () => {
    const renamedCroState = {
      ...state,
      valuationsCad: {
        ...valuations,
        cro: {
          redemptionModel: "reward-currency",
          faceValueFactorIfAutoSold: 1,
          defaultHeldRiskFactor: 0.8,
        },
        rogersEligibleServiceRedemption: { redemptionFactor: 1.5 },
      },
    };
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(stored(renamedCroState));
    vi.mocked(prisma.creditCard.findMany).mockResolvedValue([] as never);

    const ownerState = (await (await GET()).json()).ownerState;
    expect(ownerState.valuationsCad.programs.cro).toEqual(modernPrograms.cro);
    expect(ownerState.valuationsCad.rogersEligibleServiceRedemption).toBeUndefined();
  });
});

function modernProgramsWithoutAeroplan() {
  return Object.fromEntries(
    Object.entries(modernPrograms).filter(
      ([programId]) => !["aeroplan", "noRewards", "costcoCashRewards"].includes(programId),
    ),
  );
}
