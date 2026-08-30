import { describe, expect, it } from "vitest";
import {
  evaluateMerchantUnresolvedCurrency,
  rankUnresolvedMerchants,
  type UnresolvedMerchantItem,
  type UnresolvedPurchaseRecord,
} from "./unresolvedMerchantCurrencies";

function utcDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

describe("unresolvedMerchantCurrencies evaluation & ranking", () => {
  it("detects regular monthly purchases as a recurring candidate", () => {
    const purchases: UnresolvedPurchaseRecord[] = [
      {
        id: "p1",
        merchant: "courtreserve.com",
        totalCents: 1500,
        currency: null,
        purchasedAt: utcDate("2026-01-15"),
      },
      {
        id: "p2",
        merchant: "courtreserve.com",
        totalCents: 1500,
        currency: null,
        purchasedAt: utcDate("2026-02-15"),
      },
      {
        id: "p3",
        merchant: "courtreserve.com",
        totalCents: 1500,
        currency: null,
        purchasedAt: utcDate("2026-03-15"),
      },
      {
        id: "p4",
        merchant: "courtreserve.com",
        totalCents: 1500,
        currency: null,
        purchasedAt: utcDate("2026-04-15"),
      },
    ];

    const evaluated = evaluateMerchantUnresolvedCurrency("courtreserve.com", purchases, "UTC");
    expect(evaluated.isRecurringCandidate).toBe(true);
    expect(evaluated.candidateCadence?.type).toBe("MONTHLY");
    expect(evaluated.candidateMatchedPurchases).toBe(4);
    expect(evaluated.candidateCoverage).toBe(1);
    expect(evaluated.unresolvedPurchasesCount).toBe(4);
    expect(evaluated.pricedPurchasesCount).toBe(4);
    expect(evaluated.totalSpendMinor).toBe(6000);
  });

  it("handles unpriced or single purchases as non-recurring candidates", () => {
    const purchases: UnresolvedPurchaseRecord[] = [
      {
        id: "p1",
        merchant: "dominos.ca",
        totalCents: 2450,
        currency: null,
        purchasedAt: utcDate("2026-01-05"),
      },
      {
        id: "p2",
        merchant: "dominos.ca",
        totalCents: 3120,
        currency: null,
        purchasedAt: utcDate("2026-01-08"),
      },
    ];

    const evaluated = evaluateMerchantUnresolvedCurrency("dominos.ca", purchases, "UTC");
    expect(evaluated.isRecurringCandidate).toBe(false);
    expect(evaluated.candidateCadence).toBeNull();
    expect(evaluated.unresolvedPurchasesCount).toBe(2);
  });

  it("ranks recurring candidates higher than high-volume non-recurring merchants", () => {
    const recurringCandidate: UnresolvedMerchantItem = {
      merchantCanonicalId: "courtreserve.com",
      unresolvedPurchasesCount: 3,
      pricedPurchasesCount: 3,
      unpricedPurchasesCount: 0,
      totalSpendMinor: 4500,
      isRecurringCandidate: true,
      candidateCadence: { type: "MONTHLY", dayOfMonth: 15 },
      candidateMatchedPurchases: 3,
      candidateCoverage: 1.0,
      candidateMad: 0,
      allCandidateSeries: [],
      sampleDates: ["2026-01-15", "2026-02-15", "2026-03-15"],
      latestPurchaseDate: utcDate("2026-03-15"),
      earliestPurchaseDate: utcDate("2026-01-15"),
      confirmedCurrency: null,
    };

    const strayHighVolume: UnresolvedMerchantItem = {
      merchantCanonicalId: "dominos.ca",
      unresolvedPurchasesCount: 10,
      pricedPurchasesCount: 10,
      unpricedPurchasesCount: 0,
      totalSpendMinor: 25000,
      isRecurringCandidate: false,
      candidateCadence: null,
      candidateMatchedPurchases: 0,
      candidateCoverage: 0,
      candidateMad: 0,
      allCandidateSeries: [],
      sampleDates: ["2026-01-01", "2026-01-02", "2026-01-03"],
      latestPurchaseDate: utcDate("2026-03-20"),
      earliestPurchaseDate: utcDate("2026-01-01"),
      confirmedCurrency: null,
    };

    const ranked = rankUnresolvedMerchants([strayHighVolume, recurringCandidate]);
    expect(ranked[0].merchantCanonicalId).toBe("courtreserve.com");
    expect(ranked[1].merchantCanonicalId).toBe("dominos.ca");
  });

  it("ranks among recurring candidates by matched occurrences and coverage", () => {
    const biweeklyCandidate: UnresolvedMerchantItem = {
      merchantCanonicalId: "presto",
      unresolvedPurchasesCount: 11,
      pricedPurchasesCount: 11,
      unpricedPurchasesCount: 0,
      totalSpendMinor: 11000,
      isRecurringCandidate: true,
      candidateCadence: { type: "BIWEEKLY", anchor: "2026-08-26" },
      candidateMatchedPurchases: 5,
      candidateCoverage: 1.0,
      candidateMad: 0.5,
      allCandidateSeries: [],
      sampleDates: [],
      latestPurchaseDate: utcDate("2026-08-26"),
      earliestPurchaseDate: utcDate("2026-06-25"),
      confirmedCurrency: null,
    };

    const monthlyCandidate: UnresolvedMerchantItem = {
      merchantCanonicalId: "courtreserve.com",
      unresolvedPurchasesCount: 4,
      pricedPurchasesCount: 4,
      unpricedPurchasesCount: 0,
      totalSpendMinor: 6000,
      isRecurringCandidate: true,
      candidateCadence: { type: "MONTHLY", dayOfMonth: 15 },
      candidateMatchedPurchases: 3,
      candidateCoverage: 1.0,
      candidateMad: 0,
      allCandidateSeries: [],
      sampleDates: [],
      latestPurchaseDate: utcDate("2026-04-15"),
      earliestPurchaseDate: utcDate("2026-01-15"),
      confirmedCurrency: null,
    };

    const ranked = rankUnresolvedMerchants([monthlyCandidate, biweeklyCandidate]);
    expect(ranked[0].merchantCanonicalId).toBe("presto");
    expect(ranked[1].merchantCanonicalId).toBe("courtreserve.com");
  });

  it("ranks among non-recurring merchants by purchase volume then recency", () => {
    const higherVolume: UnresolvedMerchantItem = {
      merchantCanonicalId: "dominos.ca",
      unresolvedPurchasesCount: 6,
      pricedPurchasesCount: 6,
      unpricedPurchasesCount: 0,
      totalSpendMinor: 12000,
      isRecurringCandidate: false,
      candidateCadence: null,
      candidateMatchedPurchases: 0,
      candidateCoverage: 0,
      candidateMad: 0,
      allCandidateSeries: [],
      sampleDates: [],
      latestPurchaseDate: utcDate("2026-01-10"),
      earliestPurchaseDate: utcDate("2025-01-01"),
      confirmedCurrency: null,
    };

    const lowerVolumeNewer: UnresolvedMerchantItem = {
      merchantCanonicalId: "paypal.com",
      unresolvedPurchasesCount: 4,
      pricedPurchasesCount: 4,
      unpricedPurchasesCount: 0,
      totalSpendMinor: 8000,
      isRecurringCandidate: false,
      candidateCadence: null,
      candidateMatchedPurchases: 0,
      candidateCoverage: 0,
      candidateMad: 0,
      allCandidateSeries: [],
      sampleDates: [],
      latestPurchaseDate: utcDate("2026-02-10"),
      earliestPurchaseDate: utcDate("2026-01-01"),
      confirmedCurrency: null,
    };

    const ranked = rankUnresolvedMerchants([lowerVolumeNewer, higherVolume]);
    expect(ranked[0].merchantCanonicalId).toBe("dominos.ca");
    expect(ranked[1].merchantCanonicalId).toBe("paypal.com");
  });
});
