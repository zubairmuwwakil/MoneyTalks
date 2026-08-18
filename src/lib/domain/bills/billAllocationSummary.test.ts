import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Catalogue } from "@/engine/cards-twin";
import type { FxRateInput } from "@/engine/fx";
import { defaultOwnerState } from "@/lib/domain/ownerState";
import { recommendCardForBill, type BillRecommendationResult } from "./cardForBill";
import {
  computeBillAllocation,
  summarizeBillAllocations,
  type BillAllocationInput,
} from "./billAllocationSummary";

const realCatalogue = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "contracts/card-catalogue.json"), "utf-8"),
) as Catalogue;

const noRates: FxRateInput[] = [];
const today = "2026-08-17";

type RecommendedResult = Extract<BillRecommendationResult, { status: "recommended" }>;

// $200 "subscriptions" bill, mbna-rewards-we + scotia-momentum-vi-plus both
// owned: MBNA's 5x nets $10, Scotia's 4% recurring nets $8 — a known,
// deterministic $2/occurrence gap (verified against the real catalogue
// before writing these expectations, not guessed).
function recommendedResult(): RecommendedResult {
  const state = defaultOwnerState(["mbna-rewards-we", "scotia-momentum-vi-plus"])!;
  const result = recommendCardForBill(
    realCatalogue,
    state,
    { category: "subscriptions", currency: "CAD", variable: false },
    { amountMinor: 20000 },
    noRates,
    today,
  );
  if (result.status !== "recommended") throw new Error(`fixture broke: ${result.status}`);
  return result;
}

describe("computeBillAllocation", () => {
  it("a bill allocated to the better card is optimal, with delta exactly 0 (not counted as suboptimal)", () => {
    const rec = recommendedResult();
    expect(rec.winner.cardId).toBe("mbna-rewards-we"); // sanity: confirms which card is "best" here
    const result = computeBillAllocation({
      billId: "b1",
      rec,
      paymentCardId: "creditcard-mbna",
      paymentCardContractId: "mbna-rewards-we",
      occurrenceCount12mo: 12,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("optimal");
    expect(result.annualDeltaCad).toBe(0);
  });

  it("a bill allocated to the worse card is suboptimal, with delta = per-occurrence gap * 12mo occurrence count", () => {
    const rec = recommendedResult();
    const result = computeBillAllocation({
      billId: "b2",
      rec,
      paymentCardId: "creditcard-scotia",
      paymentCardContractId: "scotia-momentum-vi-plus",
      occurrenceCount12mo: 12,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("suboptimal");
    // $10 - $8 = $2/occurrence * 12 = $24/yr
    expect(result.annualDeltaCad).toBeCloseTo(24, 5);
    expect(result.bestCardId).toBe("mbna-rewards-we");
  });

  it("scales the annual delta with occurrence count (a quarterly bill counts 4x, not 12x)", () => {
    const rec = recommendedResult();
    const result = computeBillAllocation({
      billId: "b3",
      rec,
      paymentCardId: "creditcard-scotia",
      paymentCardContractId: "scotia-momentum-vi-plus",
      occurrenceCount12mo: 4,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("suboptimal");
    expect(result.annualDeltaCad).toBeCloseTo(8, 5); // $2 * 4
  });

  it("an unallocated bill (paymentCardId null) is 'unallocated', not zero-suboptimal", () => {
    const rec = recommendedResult();
    const result = computeBillAllocation({
      billId: "b4",
      rec,
      paymentCardId: null,
      paymentCardContractId: null,
      occurrenceCount12mo: 12,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("unallocated");
    expect(result.annualDeltaCad).toBeNull();
  });

  it("a card with a null contractCardId (never linked to the catalogue) is 'unscoreable', not silently optimal or suboptimal", () => {
    const rec = recommendedResult();
    const result = computeBillAllocation({
      billId: "b5",
      rec,
      paymentCardId: "creditcard-unlinked",
      paymentCardContractId: null, // this is the null-contractCardId case
      occurrenceCount12mo: 12,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("unscoreable");
    expect(result.annualDeltaCad).toBeNull();
    expect(result.detail.toLowerCase()).toContain("catalogue");
  });

  it("an allocated card the engine couldn't score (excluded, or a stale owner-state snapshot) is 'unscoreable', not a fake winner", () => {
    const rec = recommendedResult();
    const result = computeBillAllocation({
      billId: "b6",
      rec,
      paymentCardId: "creditcard-ghost",
      paymentCardContractId: "some-card-not-in-allCandidates",
      occurrenceCount12mo: 12,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("unscoreable");
    expect(result.annualDeltaCad).toBeNull();
  });

  it("housing/debt and other non-recommended bills are 'excluded', regardless of allocation", () => {
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const rec = recommendCardForBill(
      realCatalogue,
      state,
      { category: "housing", currency: "CAD", variable: false },
      { amountMinor: 250000 },
      noRates,
      today,
    );
    const result = computeBillAllocation({
      billId: "b7",
      rec,
      paymentCardId: "creditcard-mbna", // even with a card allocated
      paymentCardContractId: "mbna-rewards-we",
      occurrenceCount12mo: 12,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("excluded");
    expect(result.annualDeltaCad).toBeNull();
  });

  it("a bill with no upcoming occurrence is 'excluded' too", () => {
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const rec = recommendCardForBill(
      realCatalogue,
      state,
      { category: "utilities", currency: "CAD", variable: false },
      null,
      noRates,
      today,
    );
    const result = computeBillAllocation({
      billId: "b8",
      rec,
      paymentCardId: null,
      paymentCardContractId: null,
      occurrenceCount12mo: 0,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("excluded");
  });

  it("propagates the variable-bill estimate flag through onto the result", () => {
    const rec = recommendedResult();
    const result = computeBillAllocation({
      billId: "b9",
      rec,
      paymentCardId: "creditcard-scotia",
      paymentCardContractId: "scotia-momentum-vi-plus",
      occurrenceCount12mo: 12,
      amountIsEstimate: true,
    });
    expect(result.amountIsEstimate).toBe(true);
  });
});

describe("spend-category override actually overrides the derived mapping (feeds the allocation math with the pinned category, not the coarse one)", () => {
  it("pinning 'streaming' on a generic subscriptions bill changes the scored category away from the derived digitalMedia pick", () => {
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const derived = recommendCardForBill(
      realCatalogue,
      state,
      { category: "subscriptions", currency: "CAD", variable: false },
      { amountMinor: 5000 },
      noRates,
      today,
    );
    const overridden = recommendCardForBill(
      realCatalogue,
      state,
      { category: "subscriptions", currency: "CAD", variable: false },
      { amountMinor: 5000 },
      noRates,
      today,
      { override: "streaming" },
    );
    expect(derived.status).toBe("recommended");
    expect(overridden.status).toBe("recommended");
    if (derived.status === "recommended" && overridden.status === "recommended") {
      expect(derived.engineCategory).toBe("digitalMedia");
      expect(derived.categorySource).toBe("derived");
      expect(overridden.engineCategory).toBe("streaming");
      expect(overridden.categorySource).toBe("override");
    }
  });

  it("an override that flips a housing bill's exclusion produces a real, scoreable allocation result", () => {
    // housing is normally excluded outright; an explicit spendCategory pin
    // is the one thing that can override that (e.g. a landlord who accepts
    // card payment via a utility-coded portal) — confirms the override seam
    // reaches all the way through to computeBillAllocation, not just the
    // resolver.
    const state = defaultOwnerState(["mbna-rewards-we"])!;
    const rec = recommendCardForBill(
      realCatalogue,
      state,
      { category: "housing", currency: "CAD", variable: false },
      { amountMinor: 10000 },
      noRates,
      today,
      { override: "householdUtilities" },
    );
    expect(rec.status).toBe("recommended");
    const result = computeBillAllocation({
      billId: "b10",
      rec,
      paymentCardId: "creditcard-mbna",
      paymentCardContractId: "mbna-rewards-we",
      occurrenceCount12mo: 12,
      amountIsEstimate: false,
    });
    expect(result.status).toBe("optimal");
  });
});

describe("summarizeBillAllocations", () => {
  it("sums annualDeltaCad only over suboptimal bills, leaves excluded/unallocated/unscoreable OUT of the total (never folded in as zero)", () => {
    const rec = recommendedResult();
    const inputs: BillAllocationInput[] = [
      { billId: "opt", rec, paymentCardId: "c-mbna", paymentCardContractId: "mbna-rewards-we", occurrenceCount12mo: 12, amountIsEstimate: false },
      { billId: "sub1", rec, paymentCardId: "c-scotia", paymentCardContractId: "scotia-momentum-vi-plus", occurrenceCount12mo: 12, amountIsEstimate: false }, // $24/yr
      { billId: "sub2", rec, paymentCardId: "c-scotia2", paymentCardContractId: "scotia-momentum-vi-plus", occurrenceCount12mo: 4, amountIsEstimate: true }, // $8/yr, estimate
      { billId: "unalloc", rec, paymentCardId: null, paymentCardContractId: null, occurrenceCount12mo: 12, amountIsEstimate: false },
      { billId: "unlinked", rec, paymentCardId: "c-unlinked", paymentCardContractId: null, occurrenceCount12mo: 12, amountIsEstimate: false },
      {
        billId: "excluded",
        rec: { status: "skipped", reason: "excluded-category", detail: "no honest recommendation" },
        paymentCardId: "c-mbna",
        paymentCardContractId: "mbna-rewards-we",
        occurrenceCount12mo: 12,
        amountIsEstimate: false,
      },
    ];
    const results = inputs.map(computeBillAllocation);
    const summary = summarizeBillAllocations(results);

    expect(summary.totalBills).toBe(6);
    expect(summary.optimalCount).toBe(1);
    expect(summary.suboptimalCount).toBe(2);
    expect(summary.unallocatedCount).toBe(1);
    expect(summary.unscoreableCount).toBe(1);
    expect(summary.excludedCount).toBe(1);
    // 24 + 8 = 32, NOT diluted by the other 4 bills being folded in as 0
    expect(summary.annualDeltaCad).toBeCloseTo(32, 5);
    expect(summary.includesEstimate).toBe(true);
  });

  it("an empty bill list summarizes to all-zero counts and a zero total, not a crash", () => {
    const summary = summarizeBillAllocations([]);
    expect(summary).toEqual({
      totalBills: 0,
      suboptimalCount: 0,
      optimalCount: 0,
      excludedCount: 0,
      unallocatedCount: 0,
      unscoreableCount: 0,
      annualDeltaCad: 0,
      includesEstimate: false,
    });
  });

  it("includesEstimate stays false when every suboptimal bill has an observed (non-variable) amount", () => {
    const rec = recommendedResult();
    const results = [
      computeBillAllocation({ billId: "s1", rec, paymentCardId: "c-scotia", paymentCardContractId: "scotia-momentum-vi-plus", occurrenceCount12mo: 12, amountIsEstimate: false }),
    ];
    const summary = summarizeBillAllocations(results);
    expect(summary.includesEstimate).toBe(false);
  });
});
