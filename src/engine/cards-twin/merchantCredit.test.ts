import { describe, it, expect } from 'vitest';
import { Scorer } from './Scorer';
import type { CardState, Valuations } from './models';

/**
 * `merchantCredit` — the valuation model for merchant-locked store credit. TypeScript end of the
 * ratchet Swift's MerchantCreditProgramTests and Kotlin's MerchantCreditProgramTest hold.
 *
 * The arithmetic is identical to `ctMoney`'s today, and that is exactly why the model is
 * separate rather than folded in: `ctMoney` is a published wire-format name inside a
 * digest-pinned release (card-contracts@2.7), so it is a fact about data already in the world,
 * not an implementation detail free to be generalised. Two things that compute the same way but
 * mean different things stay two things.
 *
 * Nothing in contracts/programs.json declares `merchantCredit` yet — a brand needs a published
 * face value read from the issuer's own site before it can — so every valuation here is
 * synthetic and constructed in-file, per the convention multiMarket.test.ts sets.
 */
describe('merchantCredit valuation', () => {
  const state = {} as CardState;

  const base = {
    model: 'merchantCredit' as const,
    cadPerUnit: 1.0,
    optionalUsabilityFactor: 0.8,
    /// Disclosure, not dispatch — Scorer never reads it.
    merchantScope: ['gap'],
    basis: 'test',
  };

  const gapInc = (usabilityFactorApplied: boolean) =>
    ({ gapInc: { ...base, usabilityFactorApplied } }) as unknown as Valuations;

  it('applies face value when the usability factor is not applied', () => {
    expect(Scorer.valueCad(100, 'gapInc', gapInc(false), state)).toBeCloseTo(100, 4);
  });

  it('discounts a merchant-locked dollar when the factor is applied', () => {
    expect(Scorer.valueCad(100, 'gapInc', gapInc(true), state)).toBeCloseTo(80, 4);
  });

  it('values, rather than excludes — an unknown program is still the null case', () => {
    expect(Scorer.valueCad(100, 'notARealProgramme', gapInc(true), state)).toBeNull();
  });

  // The whole reason this is a separate model. ctMoney is a published name in a digest-pinned
  // release and must keep its own arm.
  it('leaves ctMoney valued on its own model', () => {
    const valuations = {
      ctMoney: {
        model: 'ctMoney',
        cadPerUnit: 1.0,
        optionalUsabilityFactor: 0.95,
        usabilityFactorApplied: true,
      },
    } as unknown as Valuations;
    expect(Scorer.valueCad(100, 'ctMoney', valuations, state)).toBeCloseTo(95, 4);
  });

  // The trap this model could have walked into. inferValuationModel infers `ctMoney` from the
  // presence of `cadPerUnit` for legacy owner payloads that carry no `model` key at all.
  // merchantCredit payloads always carry an explicit `model`, so they never reach that branch —
  // and widening it to cover merchantCredit would silently reclassify every legacy CT Money
  // record an owner already holds. This pins the legacy path shut.
  it('still infers ctMoney for a legacy payload that carries no model key', () => {
    const legacy = {
      ctMoney: { cadPerUnit: 1.0, optionalUsabilityFactor: 0.95, usabilityFactorApplied: true },
    } as unknown as Valuations;
    expect(Scorer.valueCad(100, 'ctMoney', legacy, state)).toBeCloseTo(95, 4);
  });
});
