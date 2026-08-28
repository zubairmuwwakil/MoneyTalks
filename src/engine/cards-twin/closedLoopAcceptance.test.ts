import { describe, it, expect } from 'vitest';
import { Scorer } from './Scorer';
import type { CardProduct, OwnerState, PurchaseContext, Valuations } from './models';

/**
 * Closed-loop acceptance — TypeScript end of the ratchet Swift's ClosedLoopAcceptanceTests and
 * Kotlin's ClosedLoopAcceptanceTest hold.
 *
 * There are two acceptance mechanisms, not one. An open-loop card is accepted because the
 * merchant takes its NETWORK; a closed-loop store card is accepted because the merchant IS its
 * issuer's store. Forcing the second through a network check made private-label cards
 * unrepresentable without guessing `network` — and the guess is not harmless: a Kohl's card
 * recorded as `visa` gets recommended at a gas station and declined at the till.
 *
 * No card in contracts/card-catalogue.json declares `privateLabel` or an `acceptance` object as
 * of card-contracts@2.7, so the card here is synthetic and built in-file, per multiMarket.test.ts.
 */

const baseValuations = {
  amexMembershipRewards: { centsPerPoint: 2 },
  marriottBonvoy: { centsPerPoint: 1 },
  mbnaRewards: { centsPerPoint: 1 },
  ctMoney: { cadPerUnit: 1, optionalUsabilityFactor: 1, usabilityFactorApplied: false },
  cro: { model: 'cro', faceValueFactorIfAutoSold: 1, defaultHeldRiskFactor: 1 },
  cashBack: { cadPerDollar: 1 },
  // Looked up by the card's own program.programId string — see multiMarket.test.ts's note.
  cashback: { model: 'cashback', cadPerDollar: 1 },
} as unknown as Valuations;

function ownerState(): OwnerState {
  return {
    ownerStateVersion: 'test',
    ownedCardIds: [],
    defaultCardId: 'kohls-charge',
    switchThreshold: { minAdvantagePercentagePoints: 0, minAdvantageCad: 0, semantics: 'either' },
    carry: { drawerCards: [] },
    cardStates: {},
    valuationsCad: baseValuations,
  };
}

const minimalCard = (cardId: string): CardProduct => ({
  cardId,
  officialName: 'Test Store Card',
  issuer: 'Test Bank',
  market: 'US',
  billingCurrency: 'USD',
  network: 'visa',
  kind: 'credit',
  fee: {},
  program: { programId: 'cashback', unit: 'cashback' },
  fxRules: [{ status: 'current', rate: 0 }],
  earnRules: [
    {
      ruleId: 'base',
      status: 'current',
      sourceType: 'issuerConfirmed',
      earn: { type: 'cashback', rate: 0.01 },
      predicate: {},
    },
  ],
  caps: [],
  perTransactionRewardVisibility: 'issuerConfirmed',
  lastVerifiedAt: '2026-08-27',
});

const asOf = '2026-08-27';

describe('closed-loop acceptance', () => {
  const closedLoopCard = (merchants: string[]): CardProduct => ({
    ...minimalCard('kohls-charge'),
    network: 'privateLabel',
    acceptance: { scope: 'closedLoop', merchants },
  });

  const at = (overrides: Partial<PurchaseContext>): PurchaseContext => ({
    amountCad: 50,
    currency: 'CAD',
    category: 'retail',
    ...overrides,
  });

  it('excludes a closed-loop card at another merchant', () => {
    const s = Scorer.score(
      closedLoopCard(['kohls']),
      at({ category: 'gasStation', merchantBrand: 'petro-canada' }),
      ownerState(),
      asOf,
    );
    expect(s.excluded).toBe(true);
    expect(s.warnings).toContain('merchantNotAccepted');
  });

  it('accepts a closed-loop card at its own merchant', () => {
    const s = Scorer.score(
      closedLoopCard(['kohls']),
      at({ merchantBrand: 'kohls' }),
      ownerState(),
      asOf,
    );
    expect(s.warnings).not.toContain('merchantNotAccepted');
    expect(s.excluded).toBe(false);
  });

  // Silence beats recommending a card that gets declined.
  it('excludes a closed-loop card when the merchant is unknown', () => {
    const s = Scorer.score(
      closedLoopCard(['kohls']),
      at({ merchantBrand: undefined }),
      ownerState(),
      asOf,
    );
    expect(s.excluded).toBe(true);
    expect(s.warnings).toContain('merchantNotAccepted');
  });

  it('does not reuse the network warning for a merchant refusal', () => {
    const s = Scorer.score(
      closedLoopCard(['kohls']),
      at({ merchantBrand: 'petro-canada' }),
      ownerState(),
      asOf,
    );
    expect(s.warnings).not.toContain('networkNotAccepted');
  });

  it('names the merchants it IS accepted at, so the exclusion is actionable', () => {
    const s = Scorer.score(
      closedLoopCard(['kohls']),
      at({ merchantBrand: 'petro-canada' }),
      ownerState(),
      asOf,
    );
    expect(s.exclusionReason).toContain('kohls');
  });

  it('still guards an open-loop card on network', () => {
    const card: CardProduct = { ...minimalCard('some-visa'), network: 'visa', acceptance: undefined };
    const s = Scorer.score(
      card,
      at({ acceptedNetworks: ['mastercard'] }),
      ownerState(),
      asOf,
    );
    expect(s.excluded).toBe(true);
    expect(s.warnings).toContain('networkNotAccepted');
  });

  // Every pre-2.7 card carries no `acceptance` at all and must take the identical path it always
  // did — absent coalesces to openLoop, never to "accepted everywhere".
  it('leaves a card with no acceptance object on the open-loop path', () => {
    const card = minimalCard('some-visa');
    expect(card.acceptance).toBeUndefined();
    const accepted = Scorer.score(card, at({ acceptedNetworks: ['visa'] }), ownerState(), asOf);
    expect(accepted.excluded).toBe(false);
    const refused = Scorer.score(card, at({ acceptedNetworks: ['amex'] }), ownerState(), asOf);
    expect(refused.warnings).toContain('networkNotAccepted');
  });
});
