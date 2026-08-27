import { describe, it, expect } from 'vitest';
import { Scorer } from './Scorer';
import { toReporting, PINNED_USD_TO_CAD } from './reportingCurrency';
import type { CardProduct, OwnerState, PurchaseContext, Valuations } from './models';

/**
 * Targeted coverage for the 2026-08-26 multi-market capabilities — deliberately NOT added to
 * engine-fixtures.json, which is a cross-language contract keyed to the real 41-card catalogue
 * (every one of which is CAD-billing today). A synthetic card belongs here, constructed directly,
 * never in the shared production catalogue (see card-catalogue.json's D3 sourcing bar).
 */

const baseValuations: Valuations = {
  amexMembershipRewards: { centsPerPoint: 2 },
  marriottBonvoy: { centsPerPoint: 1 },
  mbnaRewards: { centsPerPoint: 1 },
  ctMoney: { cadPerUnit: 1, optionalUsabilityFactor: 1, usabilityFactorApplied: false },
  cro: { model: 'cro', faceValueFactorIfAutoSold: 1, defaultHeldRiskFactor: 1 },
  cashBack: { cadPerDollar: 1 },
  // Scorer.valueCad looks up by the card's own program.programId string ("cashback", lower b —
  // see contracts/programs.json), NOT the fixed `cashBack` property above (which is a distinct,
  // unrelated key). In production this indexed entry comes from RecommendationEngine merging in
  // catalogue defaults; since this test calls Scorer.score directly, it is supplied by hand.
  cashback: { model: 'cashback', cadPerDollar: 1 },
};

function ownerState(overrides: Partial<OwnerState> = {}): OwnerState {
  return {
    ownerStateVersion: 'test',
    ownedCardIds: [],
    defaultCardId: 'usd-cashback-test',
    switchThreshold: { minAdvantagePercentagePoints: 0, minAdvantageCad: 0, semantics: 'either' },
    carry: { drawerCards: [] },
    cardStates: {},
    valuationsCad: baseValuations,
    ...overrides,
  };
}

/// A USD-billing cashback card charging 2.5% FX, with a quarterly grocery cap — the shape US
/// rotating-category cards need (e.g. Chase Freedom Flex) and this catalogue could not
/// previously express at all (no calendarQuarter, no billingCurrency).
const usdCashbackCard: CardProduct = {
  cardId: 'usd-cashback-test',
  officialName: 'Test USD Cashback Card',
  issuer: 'Test Bank',
  market: 'US',
  billingCurrency: 'USD',
  network: 'visa',
  kind: 'credit',
  fee: {},
  program: { programId: 'cashback', unit: 'cashback' },
  fxRules: [{ status: 'current', rate: 0.025 }],
  earnRules: [
    {
      ruleId: 'grocery-5x-quarterly',
      status: 'current',
      sourceType: 'issuerConfirmed',
      earn: { type: 'cashback', rate: 0.05 },
      predicate: { categories: ['grocery'] },
      capId: 'grocery-cap',
    },
    {
      ruleId: 'base',
      status: 'current',
      sourceType: 'issuerConfirmed',
      earn: { type: 'cashback', rate: 0.01 },
      predicate: {},
    },
  ],
  caps: [
    {
      capId: 'grocery-cap',
      measure: 'spendNative',
      limit: 1500,
      period: 'calendarQuarter',
      resetTimeZone: 'UTC',
      postCapEarn: { type: 'cashback', rate: 0.01 },
      proration: true,
    },
  ],
  perTransactionRewardVisibility: 'issuerConfirmed',
  lastVerifiedAt: '2026-08-26',
};

describe('multi-market: USD-billing card scoring', () => {
  it('earns on the USD-equivalent amount, not the CAD amount, for a USD-billing card', () => {
    const purchase: PurchaseContext = {
      amountCad: 137, // ~$100 USD at a 1.37 CAD/USD rate
      currency: 'CAD',
      usdEquivalent: 100,
      category: 'grocery',
      acceptedNetworks: ['visa'],
    };
    const score = Scorer.score(usdCashbackCard, purchase, ownerState(), '2026-08-26');
    expect(score.excluded).toBe(false);
    expect(score.appliedRuleId).toBe('grocery-5x-quarterly');
    // 5% of the $100 USD equivalent, not 5% of $137 CAD.
    expect(score.rewardUnits).toBeCloseTo(5, 6);
    expect(score.grossRewardCad).toBeCloseTo(5, 6);
  });

  it('falls back to the pinned CAD/USD rate when no usdEquivalent is supplied', () => {
    const purchase: PurchaseContext = {
      amountCad: 137,
      currency: 'CAD',
      category: 'grocery',
      acceptedNetworks: ['visa'],
    };
    const score = Scorer.score(usdCashbackCard, purchase, ownerState(), '2026-08-26');
    expect(score.rewardUnits).toBeCloseTo(137 * Scorer.fallbackCadToUsd * 0.05, 6);
  });

  it('charges FX when the purchase currency differs from the card\'s billing currency (USD), not just when it differs from CAD', () => {
    const cadPurchase: PurchaseContext = {
      amountCad: 137,
      currency: 'CAD',
      usdEquivalent: 100,
      category: 'other',
      acceptedNetworks: ['visa'],
    };
    const score = Scorer.score(usdCashbackCard, cadPurchase, ownerState(), '2026-08-26');
    // FX spread charged on the $100 USD-equivalent amount, converted back to the CAD reporting
    // figure — not charged on the raw $137 CAD amount, and not skipped just because CAD !== USD
    // was already true before this card existed.
    expect(score.fxCostCad).toBeCloseTo(toReporting({ amount: 100 * 0.025, currency: 'USD' }), 6);
    expect(score.fxCostCad).toBeCloseTo(100 * 0.025 * PINNED_USD_TO_CAD, 6);
  });

  it('charges no FX when the purchase currency matches the card\'s USD billing currency', () => {
    const usdPurchase: PurchaseContext = {
      amountCad: 137,
      currency: 'USD',
      usdEquivalent: 100,
      category: 'other',
      acceptedNetworks: ['visa'],
    };
    const score = Scorer.score(usdCashbackCard, usdPurchase, ownerState(), '2026-08-26');
    expect(score.fxCostCad).toBe(0);
  });

  it('splits a grocery purchase straddling the quarterly cap using the native (USD) amount', () => {
    const purchase: PurchaseContext = {
      amountCad: 274, // ~$200 USD
      currency: 'CAD',
      usdEquivalent: 200,
      category: 'grocery',
      acceptedNetworks: ['visa'],
    };
    const state = ownerState({ cardStates: { 'usd-cashback-test': { capProgress: { 'grocery-cap': 1400 } } } });
    const score = Scorer.score(usdCashbackCard, purchase, state, '2026-08-26');
    // $100 in-cap at 5%, $100 over-cap at the post-cap 1% — both in USD, not CAD.
    expect(score.rewardUnits).toBeCloseTo(100 * 0.05 + 100 * 0.01, 6);
  });
});

describe('multi-market: a draft catalogue record is never scorable', () => {
  it('excludes a card marked status: "draft" even when owned', () => {
    const draftCard: CardProduct = { ...usdCashbackCard, status: 'draft' };
    const purchase: PurchaseContext = {
      amountCad: 100,
      currency: 'CAD',
      category: 'grocery',
      acceptedNetworks: ['visa'],
    };
    const state = ownerState({ ownedCardIds: ['usd-cashback-test'] });
    const score = Scorer.score(draftCard, purchase, state, '2026-08-26');
    expect(score.excluded).toBe(true);
  });

  it('scores normally when status is "published" or absent', () => {
    const purchase: PurchaseContext = {
      amountCad: 100,
      currency: 'CAD',
      usdEquivalent: 73,
      category: 'grocery',
      acceptedNetworks: ['visa'],
    };
    expect(Scorer.score(usdCashbackCard, purchase, ownerState(), '2026-08-26').excluded).toBe(false);
    expect(
      Scorer.score({ ...usdCashbackCard, status: 'published' }, purchase, ownerState(), '2026-08-26').excluded,
    ).toBe(false);
  });
});
