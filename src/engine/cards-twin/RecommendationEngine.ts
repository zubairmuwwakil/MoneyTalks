import { Catalogue, OwnerState, PurchaseContext } from './models';
import { CandidateScore, Scorer } from './Scorer';

export type ValuationDirection = 'below' | 'above';

export interface Recommendation {
  winner: CandidateScore;
  runnerUp: CandidateScore | null;
  switchedFromDefault: boolean;
  advantageOverDefaultCad: number | null;
  defaultNotAccepted: boolean;
  suppressedBetterCard: CandidateScore | null;
  valuationSensitive: boolean;
  valuationDirection: ValuationDirection | null;
  alternateWinnerCardId: string | null;
  breakevenCentsPerPoint: number | null;
  declaredCentsPerPoint: number | null;
  allCandidates: CandidateScore[];
}

/// Catalogue defaults merged BENEATH anything the owner has declared — mirrors Swift's
/// `OwnerState.applyingCatalogueValuationDefaults()`, applied at the engine constructor because
/// that is the single funnel every scoring path reaches, including owner states restored from a
/// device that never load seed files. Without it contracts/programs.json is data nothing reads.
export function applyCatalogueValuationDefaults(
  ownerState: OwnerState,
  // Deliberately `unknown`, not a pre-narrowed ProgramValuation: `model` is an OPEN vocabulary,
  // and Scorer.valueCad infers the model at use time. Narrowing here would make a valuation model
  // PickMe adds a hard build break the moment the catalogue syncs — the same trap `programId`
  // already sprang on 2026-08-18.
  defaults: Record<string, unknown>,
): OwnerState {
  return {
    ...ownerState,
    valuationsCad: { ...defaults, ...ownerState.valuationsCad },
  };
}

export class RecommendationEngine {
  private catalogue: Catalogue;
  private ownerState: OwnerState;

  constructor(catalogue: Catalogue, ownerState: OwnerState, programDefaults?: Record<string, unknown>) {
    this.catalogue = catalogue;
    this.ownerState = programDefaults
      ? applyCatalogueValuationDefaults(ownerState, programDefaults)
      : ownerState;
  }

  recommend(purchase: PurchaseContext, asOf: string): Recommendation {
    // Score only what the owner actually holds — mirrors Swift's
    // RecommendationEngine.recommend, which this class is the twin of.
    //
    // This filter was MISSING here until 2026-08-24, and no fixture could catch
    // it: card-catalogue.json used to be exactly the owner's wallet, so "every
    // card in the catalogue" and "every card they hold" were the same set. The
    // moment the catalogue became the full product corpus, the twin started
    // recommending cards the owner does not own — 21 fixtures failed in TS while
    // all 27 passed in Swift, which is precisely the divergence the shared
    // fixture suite exists to expose.
    //
    // The empty case follows Swift too: an owner with no declared wallet falls
    // back to the whole catalogue rather than refusing to advise.
    const candidateCards =
      this.ownerState.ownedCardIds.length === 0
        ? this.catalogue.cards
        : this.catalogue.cards.filter(card => this.ownerState.ownedCardIds.includes(card.cardId));

    const scores = candidateCards
      .map(card => Scorer.score(card, purchase, this.ownerState, asOf))
      .filter(score => !score.excluded);
    
    if (scores.length === 0) {
      throw new Error('no scorable card — catalogue misconfigured');
    }

    const declared = this.rank(scores, purchase, s => s.netValueCad);
    const floor = this.rank(scores, purchase, s => s.floorNetValueCad);
    const aspirational = this.rank(scores, purchase, s => s.aspirationalNetValueCad);

    let sensitive = false;
    let direction: ValuationDirection | null = null;
    let alternateId: string | null = null;
    let breakeven: number | null = null;
    let declaredCents: number | null = null;

    if (declared.winner.cardId !== floor.winner.cardId &&
        Math.abs(declared.winner.floorNetValueCad - declared.winner.netValueCad) > 0.0001 &&
        declared.winner.rewardUnits > 0) {
      sensitive = true;
      direction = 'below';
      alternateId = floor.winner.cardId;
      breakeven = this.breakevenCents(declared.winner, floor.winner, declared.ranked, purchase);
      declaredCents = this.centsPerUnit(declared.winner);
    } else if (
        aspirational.winner.cardId !== declared.winner.cardId &&
        aspirational.winner.rewardUnits > 0 &&
        Math.abs(aspirational.winner.aspirationalNetValueCad - aspirational.winner.netValueCad) > 0.0001
    ) {
      const challenger = declared.ranked.find(c => c.cardId === aspirational.winner.cardId);
      if (challenger) {
        const flip = this.breakevenCents(challenger, declared.winner, declared.ranked, purchase);
        const benchmarkCents = ((challenger.aspirationalNetValueCad + challenger.fxCostCad) * 100) / challenger.rewardUnits;
        if (flip <= benchmarkCents + 0.0001) {
          sensitive = true;
          direction = 'above';
          alternateId = challenger.cardId;
          breakeven = flip;
          declaredCents = this.centsPerUnit(challenger);
        }
      }
    }

    return {
      winner: declared.winner,
      runnerUp: declared.runnerUp,
      switchedFromDefault: declared.switched,
      advantageOverDefaultCad: declared.advantage,
      defaultNotAccepted: declared.defaultNotAccepted,
      suppressedBetterCard: declared.suppressed,
      valuationSensitive: sensitive,
      valuationDirection: direction,
      alternateWinnerCardId: alternateId,
      breakevenCentsPerPoint: breakeven,
      declaredCentsPerPoint: declaredCents,
      allCandidates: declared.ranked
    };
  }

  private centsPerUnit(score: CandidateScore): number {
    return score.rewardUnits > 0 ? (score.grossRewardCad / score.rewardUnits) * 100 : 0;
  }

  private breakevenCents(pointsCard: CandidateScore, incumbent: CandidateScore, ranked: CandidateScore[], purchase: PurchaseContext): number {
    const t = this.ownerState.switchThreshold;
    const ppFloorCad = (t.minAdvantagePercentagePoints * purchase.amountCad) / 100;
    const requiredAdvantage = t.semantics === 'either'
      ? Math.min(t.minAdvantageCad, ppFloorCad)
      : Math.max(t.minAdvantageCad, ppFloorCad);
    const defaultId = this.ownerState.defaultCardId;

    let needed = incumbent.netValueCad + (incumbent.cardId === defaultId ? requiredAdvantage : 0);
    if (incumbent.cardId !== defaultId && pointsCard.cardId !== defaultId) {
      const defaultScore = ranked.find(s => s.cardId === defaultId);
      if (defaultScore) {
        needed = Math.max(needed, defaultScore.netValueCad + requiredAdvantage);
      }
    }
    return ((needed + pointsCard.fxCostCad) * 100) / pointsCard.rewardUnits;
  }

  private rank(scores: CandidateScore[], purchase: PurchaseContext, value: (s: CandidateScore) => number) {
    const defaultId = this.ownerState.defaultCardId;
    const ranked = [...scores].sort((a, b) => {
      const valA = value(a);
      const valB = value(b);
      if (valA !== valB) return valB - valA;
      if (a.cardId === defaultId) return -1;
      if (b.cardId === defaultId) return 1;
      return a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0;
    });

    const best = ranked[0];
    const runnerUp = ranked.length > 1 ? ranked[1] : null;

    const defaultScore = ranked.find(s => s.cardId === defaultId);
    if (!defaultScore) {
      return {
        winner: best,
        runnerUp,
        switched: true,
        advantage: null,
        defaultNotAccepted: true,
        suppressed: null,
        ranked
      };
    }

    const advantage = value(best) - value(defaultScore);
    const advantagePP = purchase.amountCad > 0 ? (advantage / purchase.amountCad) * 100 : 0;
    const t = this.ownerState.switchThreshold;
    const cadOk = advantage >= t.minAdvantageCad;
    const ppOk = advantagePP >= t.minAdvantagePercentagePoints;
    const clearsThreshold = t.semantics === 'either' ? (cadOk || ppOk) : (cadOk && ppOk);

    if (best.cardId !== defaultId && clearsThreshold) {
      return {
        winner: best,
        runnerUp,
        switched: true,
        advantage,
        defaultNotAccepted: false,
        suppressed: null,
        ranked
      };
    }

    const suppressed = (best.cardId !== defaultId && advantage > 0) ? best : null;
    return {
      winner: defaultScore,
      runnerUp: ranked.find(s => s.cardId !== defaultId) || null,
      switched: false,
      advantage: 0,
      defaultNotAccepted: false,
      suppressed,
      ranked
    };
  }
}
