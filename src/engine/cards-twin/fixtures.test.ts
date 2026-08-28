import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { RecommendationEngine } from './RecommendationEngine';
import { Catalogue, OwnerState, PurchaseContext, CardState } from './models';

interface FixtureCase {
  caseId: string;
  purchase: PurchaseContext;
  asOf?: string;
  ownerStateOverrides?: {
    cardStates?: Record<string, {
      unsetFields?: string[];
    } & Partial<CardState>>;
  };
  expected: {
    winner: string;
    winnerValueCad: number;
    winnerRule?: string;
    runnerUp?: string;
    runnerUpValueCad?: number;
    switchFromDefault?: boolean;
    advantageOverDefaultCad?: number;
    defaultNotAccepted?: boolean;
    suppressedBetterCard?: string;
    suppressedValueCad?: number;
    warnings?: string[];
    warningsAbsent?: string[];
    valuationSensitive?: boolean;
    valuationDirection?: string;
    alternateWinner?: string;
    breakevenCentsPerPoint?: number;
  };
}

describe('Engine Fixtures', () => {
  const defaultAsOf = '2026-08-20';
  
  const engineFixturesPath = path.resolve(__dirname, '../../../contracts/engine-fixtures.json');
  const cardCataloguePath = path.resolve(__dirname, '../../../contracts/card-catalogue.json');
  const ownerStatePath = path.resolve(__dirname, '../../../contracts/owner-state.json');
  const programsPath = path.resolve(__dirname, '../../../contracts/programs.json');

  const file = JSON.parse(fs.readFileSync(engineFixturesPath, 'utf-8'));
  const catalogue = JSON.parse(fs.readFileSync(cardCataloguePath, 'utf-8')) as Catalogue;
  const baseState = JSON.parse(fs.readFileSync(ownerStatePath, 'utf-8')) as OwnerState;
  // Catalogue-level defaults, exactly as Swift's SeedLoader supplies them.
  const programDefaults = JSON.parse(fs.readFileSync(programsPath, 'utf-8')).defaults;

  // Pinned rather than inherited
  baseState.valuationsCad.amexMembershipRewards.centsPerPoint = file.pinnedValuations.amexMembershipRewards;

  for (const fixture of file.cases as FixtureCase[]) {
    it(`case ${fixture.caseId}`, () => {
      // deep copy base state
      const state = JSON.parse(JSON.stringify(baseState)) as OwnerState;
      
      if (fixture.ownerStateOverrides?.cardStates) {
        for (const [cardId, override] of Object.entries(fixture.ownerStateOverrides.cardStates)) {
          const merged = state.cardStates[cardId] ?? {};
          
          if (override.capProgress) {
            merged.capProgress = { ...merged.capProgress, ...override.capProgress };
          }
          if (override.cryptoLevelUpProActive !== undefined) {
            merged.cryptoLevelUpProActive = override.cryptoLevelUpProActive;
          }
          if (override.croHandling !== undefined) {
            merged.croHandling = override.croHandling;
          }
          if (override.rogersEligibleServiceLinked !== undefined) {
            merged.rogersEligibleServiceLinked = override.rogersEligibleServiceLinked;
          }
          if (override.selectedCategories !== undefined) {
            merged.selectedCategories = override.selectedCategories;
          }
          // Owner-condition answers merge after the named legacy fields above, exactly as the
          // Swift/Kotlin fixture harnesses do. `resolvedFlags` then gives this newer map
          // precedence over a stale mirror in the base state.
          if (override.flags !== undefined) {
            merged.flags = { ...merged.flags, ...override.flags };
          }

          if (override.unsetFields) {
            merged.unsetFields = override.unsetFields;
            // An owner condition can exist in the legacy named field and in `flags`. To make it
            // genuinely unresolved, clear both forms before running the engine.
            for (const field of override.unsetFields) {
              if (field === 'capProgress') delete merged.capProgress;
              if (field === 'croHandling') delete merged.croHandling;
              if (field === 'selectedCategories') delete merged.selectedCategories;
              if (field === 'treatAsAllSelected') delete merged.treatAsAllSelected;
              if (field === 'cryptoLevelUpProActive') delete merged.cryptoLevelUpProActive;
              if (field === 'rogersEligibleServiceLinked') delete merged.rogersEligibleServiceLinked;
              if (merged.flags) {
                delete merged.flags[field];
                if (Object.keys(merged.flags).length === 0) delete merged.flags;
              }
            }
          }

          state.cardStates[cardId] = merged;
        }
      }

      const engine = new RecommendationEngine(catalogue, state, programDefaults);
      const r = engine.recommend(fixture.purchase, fixture.asOf ?? defaultAsOf);
      const e = fixture.expected;

      expect(r.winner.cardId).toBe(e.winner);
      expect(r.winner.netValueCad).toBeCloseTo(e.winnerValueCad, 3); // vitest toBeCloseTo defaults to 2 digits, 0.005 accuracy is about 3 digits (numDigits = 2 => 0.005). Let's use 2 which is 0.005
      
      if (e.winnerRule !== undefined) expect(r.winner.appliedRuleId).toBe(e.winnerRule);
      if (e.runnerUp !== undefined) expect(r.runnerUp?.cardId).toBe(e.runnerUp);
      if (e.runnerUpValueCad !== undefined) expect(r.runnerUp?.netValueCad).toBeCloseTo(e.runnerUpValueCad, 2);
      if (e.switchFromDefault !== undefined) expect(r.switchedFromDefault).toBe(e.switchFromDefault);
      if (e.advantageOverDefaultCad !== undefined) expect(r.advantageOverDefaultCad).toBeCloseTo(e.advantageOverDefaultCad, 2);
      if (e.defaultNotAccepted !== undefined) expect(r.defaultNotAccepted).toBe(e.defaultNotAccepted);
      
      if (e.suppressedBetterCard !== undefined) expect(r.suppressedBetterCard?.cardId).toBe(e.suppressedBetterCard);
      if (e.suppressedValueCad !== undefined) expect(r.suppressedBetterCard?.netValueCad).toBeCloseTo(e.suppressedValueCad, 2);

      const actualWarnings = r.winner.warnings || [];
      for (const w of e.warnings ?? []) {
        expect(actualWarnings).toContain(w);
      }
      for (const w of e.warningsAbsent ?? []) {
        expect(actualWarnings).not.toContain(w);
      }

      if (e.valuationSensitive !== undefined) expect(r.valuationSensitive).toBe(e.valuationSensitive);
      if (e.valuationDirection !== undefined) expect(r.valuationDirection).toBe(e.valuationDirection);
      if (e.alternateWinner !== undefined) expect(r.alternateWinnerCardId).toBe(e.alternateWinner);
      if (e.breakevenCentsPerPoint !== undefined) expect(r.breakevenCentsPerPoint).toBeCloseTo(e.breakevenCentsPerPoint, 2);
    });
  }
});
