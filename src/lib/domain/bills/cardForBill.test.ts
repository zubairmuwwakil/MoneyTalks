import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Catalogue } from "@/engine/cards-twin";
import type { FxRateInput } from "@/engine/fx";
import { defaultOwnerState } from "@/lib/domain/ownerState";
import {
  BILL_CATEGORY_MAPPING,
  REPRESENTATIVE_MCC,
  buildBillPurchaseContext,
  recommendCardForBill,
  resolveBillPaymentRail,
  resolveBillSpendCategory,
} from "./cardForBill";

const realCatalogue = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "contracts/card-catalogue.json"), "utf-8"),
) as Catalogue;

const noRates: FxRateInput[] = [];
const today = "2026-08-17";

describe("BILL_CATEGORY_MAPPING", () => {
  it("maps utilities -> householdUtilities / MCC 4814", () => {
    const m = BILL_CATEGORY_MAPPING.utilities;
    expect(m.recommend).toBe(true);
    if (m.recommend) {
      expect(m.engineCategory).toBe("householdUtilities");
      expect(REPRESENTATIVE_MCC[m.engineCategory]).toBe(4814);
    }
  });

  it("maps transport -> transit / MCC 4121", () => {
    const m = BILL_CATEGORY_MAPPING.transport;
    expect(m.recommend).toBe(true);
    if (m.recommend) {
      expect(m.engineCategory).toBe("transit");
      expect(REPRESENTATIVE_MCC[m.engineCategory]).toBe(4121);
    }
  });

  it("maps subscriptions -> digitalMedia / MCC 5815 (the conservative pick, not streaming)", () => {
    const m = BILL_CATEGORY_MAPPING.subscriptions;
    expect(m.recommend).toBe(true);
    if (m.recommend) {
      expect(m.engineCategory).toBe("digitalMedia");
      expect(REPRESENTATIVE_MCC[m.engineCategory]).toBe(5815);
      expect(m.rationale.toLowerCase()).toContain("conservatively");
    }
  });

  it("maps other -> recurring / MCC 6300", () => {
    const m = BILL_CATEGORY_MAPPING.other;
    expect(m.recommend).toBe(true);
    if (m.recommend) {
      expect(m.engineCategory).toBe("recurring");
      expect(REPRESENTATIVE_MCC[m.engineCategory]).toBe(6300);
    }
  });

  it("excludes housing and debt from recommendation, each with a documented reason", () => {
    for (const cat of ["housing", "debt"] as const) {
      const m = BILL_CATEGORY_MAPPING[cat];
      expect(m.recommend).toBe(false);
      if (!m.recommend) {
        expect(m.reason).toBe("excluded-category");
        expect(m.rationale.length).toBeGreaterThan(20);
      }
    }
  });

  it("every recommend:true entry has a representative MCC (no silent gaps)", () => {
    for (const [billCategory, decision] of Object.entries(BILL_CATEGORY_MAPPING)) {
      if (decision.recommend) {
        expect(REPRESENTATIVE_MCC[decision.engineCategory], `category "${billCategory}"`).toBeTypeOf("number");
      }
    }
  });
});

describe("never-null MCC guarantee (the correctness trap this module exists to defuse)", () => {
  it("buildBillPurchaseContext never returns ok:true with an undefined/null mcc, for every mapped bill category", () => {
    for (const category of Object.keys(BILL_CATEGORY_MAPPING)) {
      const result = buildBillPurchaseContext(
        { category, currency: "CAD", variable: false },
        { amountMinor: 5000 },
        noRates,
      );
      if (result.ok) {
        expect(result.context.mcc, `category "${category}"`).not.toBeUndefined();
        expect(result.context.mcc, `category "${category}"`).not.toBeNull();
        expect(result.context.mcc).toBeTypeOf("number");
        expect(result.mccAssumed).toBe(true);
      } else {
        // housing/debt: fine to be ok:false, but must never be an ok:true
        // context with a missing mcc — assert the alternative explicitly.
        expect(["excluded-category", "unmapped-category"]).toContain(result.reason);
      }
    }
  });

  it("never produces a context with a null mcc for unrecognized bill categories either", () => {
    for (const category of ["", "garbage", "HOUSING", "Utilities", "made-up-category"]) {
      const result = buildBillPurchaseContext(
        { category, currency: "CAD", variable: false },
        { amountMinor: 1000 },
        noRates,
      );
      // Every one of these is intentionally unmapped -> must be a clean skip,
      // never a context object (which would risk an undefined mcc downstream).
      expect(result.ok, `category "${category}"`).toBe(false);
    }
  });

  it("an override with no known representative MCC is refused, not passed through with mcc undefined", () => {
    const result = buildBillPurchaseContext(
      { category: "other", currency: "CAD", variable: false },
      { amountMinor: 1000 },
      noRates,
      { override: "totallyMadeUpCategory" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("override-mcc-unknown");
  });
});

describe("housing/debt never produce a recommendation", () => {
  for (const category of ["housing", "debt"]) {
    it(`recommendCardForBill(${category}) returns skipped, not a fake winner`, () => {
      const state = defaultOwnerState(["mbna-rewards-we"])!;
      const result = recommendCardForBill(
        realCatalogue,
        state,
        { category, currency: "CAD", variable: false },
        { amountMinor: 150000 },
        noRates,
        today,
      );
      expect(result.status).toBe("skipped");
      if (result.status === "skipped") {
        expect(result.reason).toBe("excluded-category");
      }
    });
  }
});

describe("category exclusion takes priority over no-cards / no-occurrence", () => {
  it("a housing bill reports excluded-category even with no owner state and no next occurrence", () => {
    const result = recommendCardForBill(
      realCatalogue,
      null,
      { category: "housing", currency: "CAD", variable: false },
      null,
      noRates,
      today,
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("excluded-category");
  });
});

describe("no-cards empty state", () => {
  it("returns no-cards when ownerState is null", () => {
    const result = recommendCardForBill(
      realCatalogue,
      null,
      { category: "utilities", currency: "CAD", variable: false },
      { amountMinor: 5000 },
      noRates,
      today,
    );
    expect(result).toEqual({ status: "no-cards" });
  });

  it("returns no-cards when ownerState has zero owned cards (never a crash or a fake pick)", () => {
    const emptyState = {
      ownerStateVersion: "test-1",
      ownedCardIds: [],
      defaultCardId: "",
      switchThreshold: { minAdvantagePercentagePoints: 0.5, minAdvantageCad: 0.25, semantics: "both" },
      carry: { drawerCards: [] },
      cardStates: {},
      valuationsCad: {
        amexMembershipRewards: { centsPerPoint: 1 },
        marriottBonvoy: { centsPerPoint: 0.8 },
        mbnaRewards: { centsPerPoint: 1 },
        ctMoney: { cadPerUnit: 1, optionalUsabilityFactor: 1, usabilityFactorApplied: false },
        cro: { model: "reward-currency", faceValueFactorIfAutoSold: 1, defaultHeldRiskFactor: 0.8 },
        cashBack: { cadPerDollar: 1 },
      },
    };
    const result = recommendCardForBill(
      realCatalogue,
      emptyState,
      { category: "utilities", currency: "CAD", variable: false },
      { amountMinor: 5000 },
      noRates,
      today,
    );
    expect(result).toEqual({ status: "no-cards" });
  });

  it("defaultOwnerState([]) is null, which the resolver also treats as no-cards", () => {
    expect(defaultOwnerState([])).toBeNull();
    const result = recommendCardForBill(
      realCatalogue,
      defaultOwnerState([]),
      { category: "utilities", currency: "CAD", variable: false },
      { amountMinor: 5000 },
      noRates,
      today,
    );
    expect(result.status).toBe("no-cards");
  });
});

describe("no upcoming occurrence", () => {
  it("returns no-upcoming-occurrence rather than crashing when next is null", () => {
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "CAD", variable: false },
      null,
      noRates,
      today,
    );
    expect(result.status).toBe("no-upcoming-occurrence");
  });
});

describe("currency / FX handling", () => {
  it("a CAD bill converts trivially (amountCad = amountMinor / 100, currency stays CAD)", () => {
    const result = buildBillPurchaseContext(
      { category: "utilities", currency: "CAD", variable: false },
      { amountMinor: 12345 },
      noRates,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.amountCad).toBeCloseTo(123.45, 5);
      expect(result.context.currency).toBe("CAD");
    }
  });

  it("a USD bill with a rate on file converts to a CAD-equivalent amount but keeps currency as USD (so the engine's FX-fee model still applies)", () => {
    const rates: FxRateInput[] = [{ base: "USD", quote: "CAD", rate: 1.35, asOf: "2026-08-01" }];
    const result = buildBillPurchaseContext(
      { category: "utilities", currency: "USD", variable: false },
      { amountMinor: 10000 }, // $100 USD
      rates,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.amountCad).toBeCloseTo(135, 5);
      expect(result.context.currency).toBe("USD");
    }
  });

  it("a USD bill with no rate on file is skipped, not silently treated as CAD", () => {
    const result = buildBillPurchaseContext(
      { category: "utilities", currency: "USD", variable: false },
      { amountMinor: 10000 },
      noRates,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fx-rate-unavailable");
  });

  it("recommendCardForBill also skips (not crashes) a USD bill with no FX rate", () => {
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "USD", variable: false },
      { amountMinor: 10000 },
      noRates,
      today,
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("fx-rate-unavailable");
  });
});

describe("category override (seam for a future per-bill pin)", () => {
  it("an override wins over the derived mapping, even flipping a housing bill into a recommendation", () => {
    const decision = resolveBillSpendCategory({ category: "housing" }, { override: "householdUtilities" });
    expect(decision.recommend).toBe(true);
    expect(decision.source).toBe("override");
    if (decision.recommend) expect(decision.engineCategory).toBe("householdUtilities");
  });

  it("falls through to the derived Bill.category table when no override is supplied", () => {
    const decision = resolveBillSpendCategory({ category: "utilities" });
    expect(decision.source).toBe("derived");
    expect(decision.recommend).toBe(true);
    if (decision.recommend) expect(decision.engineCategory).toBe("householdUtilities");
  });

  it("an unrecognized override category is refused rather than silently scored", () => {
    const decision = resolveBillSpendCategory({ category: "utilities" }, { override: "not-a-real-category" });
    expect(decision.recommend).toBe(false);
    if (!decision.recommend) expect(decision.reason).toBe("override-mcc-unknown");
  });

  it("buildBillPurchaseContext honours the override end-to-end", () => {
    const result = buildBillPurchaseContext(
      { category: "housing", currency: "CAD", variable: false },
      { amountMinor: 200000 },
      noRates,
      { override: "transit" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.category).toBe("transit");
      expect(result.context.mcc).toBe(REPRESENTATIVE_MCC.transit);
      expect(result.categorySource).toBe("override");
    }
  });
});

describe("recommendCardForBill against the real catalogue", () => {
  it("recommends MBNA's 5x for a utilities bill when MBNA is the only owned card", () => {
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "CAD", variable: false },
      { amountMinor: 10000 }, // $100
      noRates,
      today,
    );
    expect(result.status).toBe("recommended");
    if (result.status === "recommended") {
      expect(result.winner.cardId).toBe("mbna-rewards-we");
      expect(result.winner.earnDescription).toBe("5x points");
      expect(result.mcc).toBe(4814);
      expect(result.mccAssumed).toBe(true);
      expect(result.runnerUp).toBeNull();
    }
  });

  it("never recommends a card the owner doesn't hold, even when it would score higher", () => {
    // Only Scotia Momentum owned; Amex Cobalt's 3x streaming rule (if it were
    // in-catalogue and owned) must never surface as the winner.
    const state = defaultOwnerState(["scotia-momentum-vi-plus"])!;
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "subscriptions", currency: "CAD", variable: false },
      { amountMinor: 5000 },
      noRates,
      today,
    );
    expect(result.status).toBe("recommended");
    if (result.status === "recommended") {
      expect(state.ownedCardIds).toContain(result.winner.cardId);
      expect(result.winner.cardId).toBe("scotia-momentum-vi-plus");
    }
  });

  it("surfaces a runner-up and marks a small-dollar race as close when the CAD-floor threshold isn't cleared", () => {
    const state = defaultOwnerState(["mbna-rewards-we", "scotia-momentum-vi-plus"])!;
    // $10 subscription: MBNA 5% ($0.50) vs Scotia's recurring 4% ($0.40) —
    // a $0.10 gap, under the default $0.25 minAdvantageCad floor, so under
    // "both" semantics this does not clear and should read as close.
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "subscriptions", currency: "CAD", variable: false },
      { amountMinor: 1000 },
      noRates,
      today,
    );
    expect(result.status).toBe("recommended");
    if (result.status === "recommended") {
      expect(result.winner.cardId).toBe("mbna-rewards-we");
      expect(result.runnerUp?.cardId).toBe("scotia-momentum-vi-plus");
      expect(result.gapCad).not.toBeNull();
      expect(result.gapCad!).toBeCloseTo(0.1, 5);
      expect(result.isClose).toBe(true);
    }
  });

  it("does not mark a large, clearly-decided race as close", () => {
    const state = defaultOwnerState(["mbna-rewards-we", "scotia-momentum-vi-plus"])!;
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "subscriptions", currency: "CAD", variable: false },
      { amountMinor: 20000 }, // $200
      noRates,
      today,
    );
    expect(result.status).toBe("recommended");
    if (result.status === "recommended") {
      expect(result.isClose).toBe(false);
    }
  });

  it("degrades to engine-error (not a crash) when the only owned card has no scorable rule for this purchase", () => {
    // cryptocom-royal-indigo's only earn rule requires ownerConditions:
    // ["cryptoLevelUpProActive"], which defaultOwnerState leaves unset —
    // RecommendationEngine.recommend throws "no scorable card" when every
    // card in the (owner-filtered) catalogue is excluded.
    const state = defaultOwnerState(["cryptocom-royal-indigo"])!;
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "CAD", variable: false },
      { amountMinor: 5000 },
      noRates,
      today,
    );
    expect(result.status).toBe("engine-error");
  });

  it("propagates the variable-bill estimate flag onto the result", () => {
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "other", currency: "CAD", variable: true },
      { amountMinor: 4000 },
      noRates,
      today,
    );
    expect(result.status).toBe("recommended");
    if (result.status === "recommended") {
      expect(result.amountIsEstimate).toBe(true);
    }
  });
});

// --- Payment rail (eligibility) vs. category (earn rate) -------------------

describe("resolveBillPaymentRail", () => {
  it("defers to the category table when no rail is on file", () => {
    expect(resolveBillPaymentRail({}).gate).toBe("defer-to-category");
    expect(resolveBillPaymentRail({ paymentRail: "unknown" }).gate).toBe("defer-to-category");
    expect(resolveBillPaymentRail({ paymentRail: null }).gate).toBe("defer-to-category");
  });

  it("blocks a PAD-only biller outright — a card cannot pay it at any reward rate", () => {
    const decision = resolveBillPaymentRail({ paymentRail: "pad" });
    expect(decision.gate).toBe("blocked");
    if (decision.gate === "blocked") {
      expect(decision.reason).toBe("rail-not-card-payable");
      expect(decision.rationale.length).toBeGreaterThan(20);
    }
  });

  it("allows a directly card-payable biller at zero fee", () => {
    const decision = resolveBillPaymentRail({ paymentRail: "card" });
    expect(decision.gate).toBe("allow");
    if (decision.gate === "allow") expect(decision.feePct).toBe(0);
  });

  it("allows a third-party card rail at its stated fee", () => {
    const decision = resolveBillPaymentRail({ paymentRail: "card_via_third_party", railFeePct: 2.5 });
    expect(decision.gate).toBe("allow");
    if (decision.gate === "allow") expect(decision.feePct).toBe(2.5);
  });

  it("blocks a third-party card rail whose fee is unknown rather than assuming it is free", () => {
    const decision = resolveBillPaymentRail({ paymentRail: "card_via_third_party" });
    expect(decision.gate).toBe("blocked");
    if (decision.gate === "blocked") expect(decision.reason).toBe("rail-fee-unknown");
  });
});

describe("rail gates recommendation independently of category", () => {
  const state = defaultOwnerState(["mbna-rewards-we"])!;

  // The bug this whole dimension exists to fix: Durham Region water is a
  // `utilities` bill (a recommendable category) that only accepts
  // pre-authorized debit from a chequing/savings account.
  it("a PAD-only utilities bill is skipped, not handed a card it cannot use", () => {
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "CAD", variable: false, paymentRail: "pad" },
      { amountMinor: 12000 },
      noRates,
      today,
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("rail-not-card-payable");
  });

  it("a utilities bill with no rail on file still recommends exactly as before", () => {
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "CAD", variable: false },
      { amountMinor: 12000 },
      noRates,
      today,
    );
    expect(result.status).toBe("recommended");
  });

  it("an explicitly card-payable housing bill is recommended despite the category exclusion", () => {
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "housing", currency: "CAD", variable: false, paymentRail: "card" },
      { amountMinor: 45810 },
      noRates,
      today,
    );
    expect(result.status).toBe("recommended");
    // Falls back to the MCC-agnostic catch-all: housing has no engine
    // category of its own, and guessing one risks a false MCC-gated bonus.
    if (result.status === "recommended") expect(result.engineCategory).toBe("recurring");
  });

  it("a housing bill with no rail on file is still excluded exactly as before", () => {
    const result = recommendCardForBill(
      realCatalogue,
      state,
      { category: "housing", currency: "CAD", variable: false },
      { amountMinor: 45810 },
      noRates,
      today,
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toBe("excluded-category");
  });
});

describe("third-party card rail fees are netted against the reward", () => {
  const state = defaultOwnerState(["mbna-rewards-we"])!;
  const amountMinor = 100000; // $1,000

  function run(rail: { paymentRail?: string; railFeePct?: number }) {
    return recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "CAD", variable: false, ...rail },
      { amountMinor },
      noRates,
      today,
    );
  }

  it("reports a zero fee and an unchanged net value on a direct card rail", () => {
    const result = run({ paymentRail: "card" });
    expect(result.status).toBe("recommended");
    if (result.status === "recommended") {
      expect(result.railFeeCad).toBe(0);
      expect(result.netValueAfterFeeCad).toBeCloseTo(result.winner.netValueCad, 6);
    }
  });

  it("subtracts the fee from the winner's net value when the reward still clears it", () => {
    const baseline = run({ paymentRail: "card" });
    expect(baseline.status).toBe("recommended");
    if (baseline.status !== "recommended") return;

    // Pick a fee small enough that the reward survives it.
    const feePct = (baseline.winner.netValueCad / 1000) * 100 * 0.5;
    const result = run({ paymentRail: "card_via_third_party", railFeePct: feePct });

    expect(result.status).toBe("recommended");
    if (result.status === "recommended") {
      expect(result.railFeeCad).toBeCloseTo((feePct / 100) * 1000, 6);
      expect(result.netValueAfterFeeCad).toBeCloseTo(baseline.winner.netValueCad - result.railFeeCad, 6);
      expect(result.netValueAfterFeeCad).toBeGreaterThan(0);
    }
  });

  it("refuses to recommend when the fee swallows the reward, and says so with real numbers", () => {
    const baseline = run({ paymentRail: "card" });
    expect(baseline.status).toBe("recommended");
    if (baseline.status !== "recommended") return;

    // A fee comfortably larger than any reward this catalogue can earn.
    const feePct = (baseline.winner.netValueCad / 1000) * 100 * 2;
    const result = run({ paymentRail: "card_via_third_party", railFeePct: feePct });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("rail-fee-exceeds-reward");
      // The whole point of carrying the fee: the refusal is computed, not
      // boilerplate — it must quote the actual dollars on both sides.
      expect(result.detail).toMatch(/\$\d/);
    }
  });

  it("a flat rail fee never reorders the candidates it is subtracted from", () => {
    const twoCards = defaultOwnerState(["mbna-rewards-we", "amex-cobalt"])!;
    const score = (railFeePct?: number) =>
      recommendCardForBill(
        realCatalogue,
        twoCards,
        {
          category: "utilities",
          currency: "CAD",
          variable: false,
          ...(railFeePct === undefined ? {} : { paymentRail: "card_via_third_party", railFeePct }),
        },
        { amountMinor },
        noRates,
        today,
      );

    const free = score();
    const fee = score(0.1);
    expect(free.status).toBe("recommended");
    expect(fee.status).toBe("recommended");
    if (free.status === "recommended" && fee.status === "recommended") {
      expect(fee.winner.cardId).toBe(free.winner.cardId);
      expect(fee.runnerUp?.cardId ?? null).toBe(free.runnerUp?.cardId ?? null);
      // The gap between cards is fee-invariant — the fee hits every
      // candidate identically, so allocation deltas must not move.
      expect(fee.gapCad ?? 0).toBeCloseTo(free.gapCad ?? 0, 6);
    }
  });
});
