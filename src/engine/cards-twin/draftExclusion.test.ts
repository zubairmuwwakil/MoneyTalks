import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RecommendationEngine } from './RecommendationEngine';
import { Scorer } from './Scorer';
import type { Catalogue, OwnerState, PurchaseContext } from './models';

/**
 * The draft guard, exercised against the REAL catalogue and the REAL owner state.
 *
 * `multiMarket.test.ts` already covers this with a synthetic card, which proves the branch in
 * `Scorer.score` works. It cannot prove the thing that actually matters: that a draft record
 * shipped in contracts/card-catalogue.json is unreachable through the paths a user's money goes
 * down. That gap was called out as open problem #3 in the Stage B report and could not be
 * closed until a real draft existed — catalogue 2.2 is the first release that has any.
 */
describe('draft cards in the real catalogue', () => {
  const read = (name: string) =>
    JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../contracts/${name}`), 'utf-8'));

  const catalogue = read('card-catalogue.json') as Catalogue;
  const ownerState = read('owner-state.json') as OwnerState;
  const programDefaults = read('programs.json').defaults;
  const asOf = '2026-08-27';

  const drafts = catalogue.cards.filter((c) => c.status === 'draft');
  const purchase: PurchaseContext = {
    amountCad: 100,
    currency: 'CAD',
    category: 'dining',
    acceptedNetworks: ['amex', 'visa', 'mastercard', 'discover'],
  } as PurchaseContext;

  it('ships at least one draft, or this whole file is vacuously green', () => {
    expect(drafts.length).toBeGreaterThan(0);
  });

  it('scores no draft, and says why', () => {
    for (const card of drafts) {
      const score = Scorer.score(card, purchase, ownerState, asOf);
      expect(score.excluded).toBe(true);
      expect(score.exclusionReason).toContain('draft');
    }
  });

  it('refuses a draft even when the owner somehow holds it', () => {
    const draft = drafts[0];
    // The state a bug would produce: a draft linked to the owner's wallet. It must lose on the
    // guard, not on arithmetic — a draft carries earnRules: [], so scoring it would quietly
    // return zero and rank it last instead of declaring it unscorable.
    const holdingADraft: OwnerState = {
      ...ownerState,
      ownedCardIds: [...ownerState.ownedCardIds, draft.cardId],
    };
    const engine = new RecommendationEngine(catalogue, holdingADraft, programDefaults);
    const rec = engine.recommend(purchase, asOf);

    expect(rec.winner.cardId).not.toBe(draft.cardId);
    expect(rec.allCandidates.map((c) => c.cardId)).not.toContain(draft.cardId);
  });

  it('never lets a draft reach an empty-wallet owner in its own market', () => {
    // recommend() falls back to the whole catalogue, market-scoped, when the owner has declared
    // no wallet. Every US card in 2.2 is a draft, so this is the path where a new US owner would
    // meet one — and where, all candidates being excluded, the engine must fail loudly rather
    // than return something it cannot stand behind.
    const newUsOwner: OwnerState = { ...ownerState, ownedCardIds: [], market: 'US' };
    const engine = new RecommendationEngine(catalogue, newUsOwner, programDefaults);

    expect(() => engine.recommend(purchase, asOf)).toThrow(/no scorable card/);
  });

  it('still advises an empty-wallet Canadian owner, whose market has published cards', () => {
    const newCaOwner: OwnerState = { ...ownerState, ownedCardIds: [], market: 'CA' };
    const engine = new RecommendationEngine(catalogue, newCaOwner, programDefaults);
    const rec = engine.recommend(purchase, asOf);

    expect(rec.winner).toBeDefined();
    const draftIds = new Set(drafts.map((d) => d.cardId));
    expect(rec.allCandidates.every((c) => !draftIds.has(c.cardId))).toBe(true);
  });
});
