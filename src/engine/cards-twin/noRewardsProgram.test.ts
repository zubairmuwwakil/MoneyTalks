import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Scorer } from './Scorer';
import type { CardState, Valuations } from './models';

/**
 * `noRewards` — the valuation model for a card that earns nothing. TypeScript end of the ratchet
 * Swift's NoRewardsProgramTests and Kotlin's NoRewardsProgramTest hold.
 *
 * The distinction under test is the one valueCad has always drawn and could not previously
 * express: a MISSING valuation returns null and Scorer excludes the card, because "we do not know
 * what this is worth" must never rank as "worth nothing". A card with no rewards programme is the
 * other case — valued, at zero — and had no way to say so, because `program` is a required field
 * with a closed programId enum. MBNA True Line and Capital One Guaranteed Secured forced it.
 */
describe('noRewards valuation', () => {
  const read = (n: string) =>
    JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../contracts/${n}`), 'utf-8'));

  const valuations = read('programs.json').defaults as Valuations;
  const state = {} as CardState;

  it('values to zero rather than null', () => {
    expect(Scorer.valueCad(100, 'noRewards', valuations, state)).toBe(0);
  });

  it('keeps the unvalued case distinct — an unknown program is still null', () => {
    expect(Scorer.valueCad(100, 'notARealProgramme', valuations, state)).toBeNull();
  });

  it('ships the default with its disclosure, or every card on it is excluded', () => {
    const v = (valuations as Record<string, { model?: string; basis?: string }>).noRewards;
    expect(v?.model).toBe('noRewards');
    expect(v?.basis ?? '').not.toBe('');
  });

  it('is declared by a real card, which is what justifies the default existing', () => {
    const onIt = read('card-catalogue.json').cards
      .filter((c: { program: { programId: string } }) => c.program.programId === 'noRewards');
    expect(onIt.length).toBeGreaterThan(0);
  });
});
