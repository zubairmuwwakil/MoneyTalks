import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Scorer } from './Scorer';
import { publishedCards } from '@/lib/contracts/cardCatalogue';
import type { CardState, Valuations } from './models';

/**
 * Co-brand reward currencies: `programId` values that name a real currency, carry no valuation, and
 * are safe only because every card on them is a draft. TypeScript end of the ratchet Swift's
 * CoBrandProgramTests and Kotlin's CoBrandProgramTest hold.
 *
 * Catalogue 2.4 opened the enum to the co-brand currencies the US market is mostly made of — Avios,
 * AAdvantage, SkyMiles, Atmos Rewards. The 2026-08-27 Option 1 ruling refused to map those onto a
 * near-enough existing value, because a Delta card recorded as `amexMembershipRewardsUs` is not
 * approximately right: it values the card in a currency it does not earn, with the schema's
 * authority behind the claim.
 *
 * None of them is valued in programs.json, because centsPerPoint is a DISCLOSED ASSUMPTION and
 * there is no honest source for one yet. That is safe here for a reason this repo learned the hard
 * way and has to keep re-learning: `status` arrived as a Scorer concept, and the presentation layer
 * did not know about it until `publishedCards()` was introduced. So this file asserts the consumer
 * property directly — an unvalued co-brand card must never reach a user-facing surface — rather
 * than trusting that the engine guard covers it.
 *
 * Nothing here hardcodes the new programIds. The set is DERIVED as "declared by a card, absent from
 * programs.json", so it maintains itself as the remaining co-brand currencies land.
 */
describe('co-brand reward currencies', () => {
  const read = (n: string) =>
    JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../contracts/${n}`), 'utf-8'));

  const catalogue = read('card-catalogue.json');
  const valuations = read('programs.json').defaults as Valuations;
  const state = {} as CardState;

  type Card = {
    cardId: string;
    market: string;
    status?: string;
    program: { programId: string; unit: string };
    earnRules: unknown[];
    fxRules: unknown[];
    caps: unknown[];
  };
  const cards: Card[] = catalogue.cards;

  /** Programmes some card declares and programs.json does not value. */
  const unvalued = new Set(
    cards
      .map((c) => c.program.programId)
      .filter((p) => !(p in (valuations as Record<string, unknown>)))
  );

  it('has at least one, or this whole file is asserting nothing', () => {
    expect(unvalued.size).toBeGreaterThan(0);
  });

  it('never publishes a card on a programme it cannot value', () => {
    const leaked = cards
      .filter((c) => unvalued.has(c.program.programId) && (c.status ?? 'published') === 'published')
      .map((c) => `${c.cardId} (${c.program.programId})`);
    expect(leaked).toEqual([]);
  });

  /**
   * The consumer-side half, and the one this repo actually got wrong before: `catalogueChoices` and
   * five other surfaces read the raw corpus the day 2.2 landed and offered drafts to users. Reading
   * through the `publishedCards()` chokepoint is the rule (CLAUDE.md); this proves the rule still
   * excludes every unvalued co-brand card rather than merely being written down.
   */
  it('keeps them out of every user-facing surface via publishedCards()', () => {
    const visible = publishedCards()
      .filter((c) => unvalued.has(c.program.programId))
      .map((c) => c.cardId);
    expect(visible).toEqual([]);
  });

  it('answers null, not zero — the unvalued case stays distinct from noRewards', () => {
    for (const program of unvalued) {
      expect(Scorer.valueCad(100, program, valuations, state)).toBeNull();
    }
  });

  it('claims no earn structure — a draft states identity and fee and nothing else', () => {
    for (const card of cards.filter((c) => unvalued.has(c.program.programId))) {
      expect(card.earnRules, card.cardId).toEqual([]);
      expect(card.fxRules, card.cardId).toEqual([]);
      expect(card.caps, card.cardId).toEqual([]);
    }
  });

  /**
   * Avios is the shared IAG currency: British Airways, Aer Lingus and Iberia all earn it, and RBC's
   * Canadian British Airways card earns it into the same Executive Club account. One programId
   * across two markets is INTENDED, on the same 2026-08-27 side-ruling that keeps marriottBonvoy
   * and aeroplan cross-market — valuation is keyed on programId alone, so sharing one is correct
   * precisely when the currency is genuinely the same. It is not correct for currencies that merely
   * rhyme, which is why the Costco certificates were left out: the CIBC one is CAD and spends only
   * in Canadian warehouses, the Citi one is USD and spends only in US ones.
   */
  it('shares one programId across markets for Avios, which is deliberate', () => {
    const avios = cards.filter((c) => c.program.programId === 'avios');
    expect(avios.map((c) => c.cardId).sort()).toEqual([
      'chase-aer-lingus-visa-signature-card',
      'chase-british-airways-visa-signature-card',
      'chase-iberia-visa-signature-card',
      'royal-bank-of-canada-rbc-british-airways-visa'
    ]);
    expect(new Set(avios.map((c) => c.market))).toEqual(new Set(['US', 'CA']));
  });
});
