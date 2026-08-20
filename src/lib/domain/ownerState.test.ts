import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { RecommendationEngine, Catalogue } from "@/engine/cards-twin";
import { defaultOwnerState, ensureOwnerStateRecord, mergeOwnerState } from "./ownerState";

const catalogue = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "contracts/card-catalogue.json"), "utf-8"),
) as Catalogue;

describe("defaultOwnerState", () => {
  it("returns null when the user has no contract-linked cards", () => {
    expect(defaultOwnerState([])).toBeNull();
  });

  it("produces a state the real engine can score with", () => {
    const state = defaultOwnerState(["amex-cobalt", "wealthsimple-vip"]);
    expect(state).not.toBeNull();

    const engine = new RecommendationEngine(catalogue, state!);
    const recommendation = engine.recommend(
      { amountCad: 100, currency: "CAD", category: "unknown", merchantBrand: "Test Merchant" },
      "2026-08-17",
    );
    expect(recommendation.winner).toBeTruthy();
    expect(recommendation.allCandidates.length).toBeGreaterThan(0);
    expect(state!.ownedCardIds).toContain(recommendation.winner.cardId);
  });

  it("dedupes contract card ids and uses the first as default", () => {
    const state = defaultOwnerState(["amex-cobalt", "amex-cobalt", "wealthsimple-vip"]);
    expect(state!.ownedCardIds).toEqual(["amex-cobalt", "wealthsimple-vip"]);
    expect(state!.defaultCardId).toBe("amex-cobalt");
  });
});

// --- ensureOwnerStateRecord ------------------------------------------------
//
// db is a hand-rolled mock of the narrow OwnerStateDb shape (ownerStateRecord
// + creditCard delegates). Matches the mocking style already used for
// Prisma.TransactionClient in walletNormalization.test.ts.

function makeDb() {
  return {
    ownerStateRecord: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    creditCard: {
      findMany: vi.fn(),
    },
  };
}

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    ownerStateVersion: "default-1",
    ownedCardIds: ["amex-cobalt"],
    defaultCardId: "amex-cobalt",
    switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
    carry: { drawerCards: [] },
    cardStates: {},
    valuationsCad: {
      amexMembershipRewards: { centsPerPoint: 1, floorCentsPerPoint: 1, basis: "default cash floor" },
    },
    ...overrides,
  };
}

function makeRecord(stateData: Record<string, unknown>, updatedAt = new Date("2026-08-01T00:00:00Z")) {
  return {
    id: "owner-1",
    userId: "user-1",
    stateData,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt,
  };
}

describe("ensureOwnerStateRecord", () => {
  it("makes a card linked after the record already exists scoreable (the reported bug)", async () => {
    const db = makeDb();
    const existing = makeRecord(baseState());
    const reread = makeRecord(
      baseState({ ownedCardIds: ["amex-cobalt", "wealthsimple-vip"] }),
      new Date("2026-08-02T00:00:00Z"),
    );
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(reread);
    db.creditCard.findMany.mockResolvedValue([{ contractCardId: "wealthsimple-vip" }]);
    db.ownerStateRecord.updateMany.mockResolvedValue({ count: 1 });

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect((result!.stateData as any).ownedCardIds).toEqual(["amex-cobalt", "wealthsimple-vip"]);
    expect(db.ownerStateRecord.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", updatedAt: existing.updatedAt },
      data: {
        stateData: expect.objectContaining({
          ownedCardIds: ["amex-cobalt", "wealthsimple-vip"],
          defaultCardId: "amex-cobalt",
        }),
      },
    });
  });

  it("keeps every stored id for an iOS-only user with zero CreditCard rows", async () => {
    const db = makeDb();
    const existing = makeRecord(
      baseState({ ownedCardIds: ["scotia-passport", "amex-cobalt"], defaultCardId: "scotia-passport" }),
    );
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing);
    db.creditCard.findMany.mockResolvedValue([]);

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect((result!.stateData as any).ownedCardIds).toEqual(["scotia-passport", "amex-cobalt"]);
    expect(db.ownerStateRecord.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a stored id that has no backing CreditCard row when reconciliation does write", async () => {
    const db = makeDb();
    const existing = makeRecord(baseState({ ownedCardIds: ["ghost-card"], defaultCardId: "ghost-card" }));
    const reread = makeRecord(
      baseState({ ownedCardIds: ["ghost-card", "amex-cobalt"], defaultCardId: "ghost-card" }),
      new Date("2026-08-02T00:00:00Z"),
    );
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(reread);
    // "amex-cobalt" is a real CreditCard row; "ghost-card" is not backed by any.
    db.creditCard.findMany.mockResolvedValue([{ contractCardId: "amex-cobalt" }]);
    db.ownerStateRecord.updateMany.mockResolvedValue({ count: 1 });

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect((result!.stateData as any).ownedCardIds).toEqual(["ghost-card", "amex-cobalt"]);
  });

  it("repoints defaultCardId to the first union member when the stored default is no longer owned", async () => {
    const db = makeDb();
    const existing = makeRecord(
      baseState({ ownedCardIds: ["amex-cobalt", "wealthsimple-vip"], defaultCardId: "deleted-card" }),
    );
    const reread = makeRecord(
      baseState({ ownedCardIds: ["amex-cobalt", "wealthsimple-vip"], defaultCardId: "amex-cobalt" }),
      new Date("2026-08-02T00:00:00Z"),
    );
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(reread);
    db.creditCard.findMany.mockResolvedValue([]);
    db.ownerStateRecord.updateMany.mockResolvedValue({ count: 1 });

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect((result!.stateData as any).defaultCardId).toBe("amex-cobalt");
    expect(db.ownerStateRecord.updateMany).toHaveBeenCalled();
  });

  it("leaves a still-valid defaultCardId alone (no gratuitous repoint)", async () => {
    const db = makeDb();
    const existing = makeRecord(
      baseState({ ownedCardIds: ["amex-cobalt", "wealthsimple-vip"], defaultCardId: "wealthsimple-vip" }),
    );
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing);
    db.creditCard.findMany.mockResolvedValue([]);

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect((result!.stateData as any).defaultCardId).toBe("wealthsimple-vip");
    expect(db.ownerStateRecord.updateMany).not.toHaveBeenCalled();
  });

  it("carries switchThreshold, valuationsCad, and cardStates through a reconciling write byte-identical", async () => {
    const db = makeDb();
    const switchThreshold = { minAdvantagePercentagePoints: 1.25, minAdvantageCad: 5, semantics: "either" };
    const valuationsCad = { amexMembershipRewards: { centsPerPoint: 2, floorCentsPerPoint: 1, basis: "custom" } };
    const cardStates = { "amex-cobalt": { selectedCategories: ["dining"] } };
    const existing = makeRecord(baseState({ switchThreshold, valuationsCad, cardStates }));
    const reread = makeRecord(
      baseState({ ownedCardIds: ["amex-cobalt", "wealthsimple-vip"], switchThreshold, valuationsCad, cardStates }),
      new Date("2026-08-02T00:00:00Z"),
    );
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(reread);
    db.creditCard.findMany.mockResolvedValue([{ contractCardId: "wealthsimple-vip" }]);
    db.ownerStateRecord.updateMany.mockResolvedValue({ count: 1 });

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    const data = result!.stateData as any;
    expect(data.switchThreshold).toEqual(switchThreshold);
    expect(data.valuationsCad).toEqual(valuationsCad);
    expect(data.cardStates).toEqual(cardStates);

    const writePayload = db.ownerStateRecord.updateMany.mock.calls[0][0].data.stateData;
    expect(writePayload.switchThreshold).toEqual(switchThreshold);
    expect(writePayload.valuationsCad).toEqual(valuationsCad);
    expect(writePayload.cardStates).toEqual(cardStates);
  });

  it("returns null, not an empty invalid state, when there is no record and no contract-linked cards", async () => {
    const db = makeDb();
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(null);
    db.creditCard.findMany.mockResolvedValue([]);

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect(result).toBeNull();
    expect(db.ownerStateRecord.create).not.toHaveBeenCalled();
  });

  it("does not write when the union already equals what is stored", async () => {
    const db = makeDb();
    const existing = makeRecord(baseState({ ownedCardIds: ["amex-cobalt"], defaultCardId: "amex-cobalt" }));
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing);
    db.creditCard.findMany.mockResolvedValue([{ contractCardId: "amex-cobalt" }]);

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect(result).toBe(existing);
    expect(db.ownerStateRecord.updateMany).not.toHaveBeenCalled();
  });

  it("fails safe (returns the record unmodified, no crash, no write) when stored stateData is malformed", async () => {
    const db = makeDb();
    const existing = makeRecord({ ownedCardIds: "not-an-array", defaultCardId: "amex-cobalt" });
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing);
    db.creditCard.findMany.mockResolvedValue([{ contractCardId: "wealthsimple-vip" }]);

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect(result).toBe(existing);
    expect(db.ownerStateRecord.updateMany).not.toHaveBeenCalled();
  });

  it("does not throw or clobber a concurrent writer's result when it loses the optimistic-concurrency race", async () => {
    const db = makeDb();
    const existing = makeRecord(baseState());
    // Simulates an iOS PUT (or another concurrent reconciliation pass)
    // landing between our read and our write: the re-read after our lost
    // updateMany sees an already-current, unrelated state.
    const concurrentlyWritten = makeRecord(
      baseState({ ownedCardIds: ["td-aeroplan"], defaultCardId: "td-aeroplan" }),
      new Date("2026-08-03T00:00:00Z"),
    );
    db.ownerStateRecord.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(concurrentlyWritten);
    db.creditCard.findMany.mockResolvedValue([{ contractCardId: "wealthsimple-vip" }]);
    db.ownerStateRecord.updateMany.mockResolvedValue({ count: 0 }); // lost the CAS

    const result = await ensureOwnerStateRecord(db as any, "user-1");

    expect(result).toBe(concurrentlyWritten);
  });
});

// ---------------------------------------------------------------------------
// mergeOwnerState — the two-writer contract (ratified 2026-08-19).
//
// PickMe and the web both author owner state. Before this existed, the iOS
// PUT replaced `stateData` wholesale, so a card set or a condition answer
// authored on the web vanished the next time the phone saved its wallet.
// ---------------------------------------------------------------------------
describe("mergeOwnerState", () => {
  const base = {
    ownerStateVersion: "wallet-setup-1",
    ownedCardIds: ["amex-cobalt"],
    defaultCardId: "amex-cobalt",
    switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" as const },
    carry: { drawerCards: [] },
    cardStates: {} as Record<string, unknown>,
    valuationsCad: { cashBack: { cadPerDollar: 1 } },
  };

  it("returns the incoming state unchanged when nothing is stored", () => {
    expect(mergeOwnerState(null, base)).toEqual(base);
  });

  it("unions owned cards and never drops one the writer could not see", () => {
    const stored = { ...base, ownedCardIds: ["amex-cobalt", "td-aeroplan-visa-infinite"] };
    const incoming = { ...base, ownedCardIds: ["amex-cobalt", "rogers-red-we"] };
    expect(mergeOwnerState(stored, incoming).ownedCardIds).toEqual([
      "amex-cobalt", "td-aeroplan-visa-infinite", "rogers-red-we",
    ]);
  });

  it("keeps a card state the incoming writer never mentioned", () => {
    const stored = {
      ...base,
      ownedCardIds: ["amex-cobalt", "tangerine-moneyback-world"],
      cardStates: {
        "tangerine-moneyback-world": { selectedCategories: ["groceries", "gas"] },
        "amex-cobalt": { capProgress: { "cobalt-eats-cap": 100 } },
      } as Record<string, unknown>,
    };
    const incoming = {
      ...base,
      cardStates: { "amex-cobalt": { capProgress: { "cobalt-eats-cap": 250 } } } as Record<string, unknown>,
    };
    const merged = mergeOwnerState(stored, incoming);
    expect(merged.cardStates["tangerine-moneyback-world"]).toEqual({ selectedCategories: ["groceries", "gas"] });
    expect(merged.cardStates["amex-cobalt"]).toEqual({ capProgress: { "cobalt-eats-cap": 250 } });
  });

  it("lets the incoming writer clear a field on a card it did mention", () => {
    const stored = { ...base, cardStates: { "rogers-red-we": { rogersEligibleServiceLinked: true } } as Record<string, unknown> };
    const incoming = { ...base, cardStates: { "rogers-red-we": {} } as Record<string, unknown> };
    expect(mergeOwnerState(stored, incoming).cardStates["rogers-red-we"]).toEqual({});
  });

  it("takes the incoming settings wholesale — last writer wins off the card set", () => {
    const stored = { ...base, switchThreshold: { minAdvantagePercentagePoints: 9, minAdvantageCad: 9, semantics: "either" as const } };
    const incoming = { ...base, switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" as const } };
    expect(mergeOwnerState(stored, incoming).switchThreshold).toEqual(incoming.switchThreshold);
  });

  it("keeps the default card inside the union", () => {
    const stored = { ...base, ownedCardIds: ["amex-cobalt"], defaultCardId: "amex-cobalt" };
    const incoming = { ...base, ownedCardIds: ["rogers-red-we"], defaultCardId: "rogers-red-we" };
    expect(mergeOwnerState(stored, incoming).defaultCardId).toBe("rogers-red-we");
  });

  it("repoints a default that the union cannot honour rather than storing a dangling id", () => {
    const stored = { ...base, ownedCardIds: ["amex-cobalt"] };
    const incoming = { ...base, ownedCardIds: ["amex-cobalt"], defaultCardId: "sold-this-one" };
    expect(mergeOwnerState(stored, incoming).defaultCardId).toBe("amex-cobalt");
  });

  it("treats unusable stored data as absent instead of throwing", () => {
    expect(mergeOwnerState("not an object" as never, base)).toEqual(base);
  });
});
