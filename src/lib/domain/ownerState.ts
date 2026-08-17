import { Prisma } from "@prisma/client";
import type { OwnerState } from "@/engine/cards-twin";

// Auto-provisioning for OwnerStateRecord. Before this existed, the only
// creation path was a script hardcoded to one developer's machine, so every
// new account silently got zero recommendations and zero cap tracking.
//
// The default state is deliberately minimal and conservative: owned cards
// come from the user's CreditCard rows, point valuations sit at their cash
// floors, and cardStates stays empty — the engine refuses to score rules
// whose owner conditions are unresolved, which is exactly the safe behavior
// for a user who hasn't answered those questions yet.

const DEFAULT_SWITCH_THRESHOLD = {
  minAdvantagePercentagePoints: 0.5,
  minAdvantageCad: 0.25,
  // "both" is the safer reading: an "either" lets a 0.1pp edge trigger a
  // switch recommendation on any large purchase.
  semantics: "both",
};

const FLOOR_VALUATIONS = {
  amexMembershipRewards: { centsPerPoint: 1.0, floorCentsPerPoint: 1.0, basis: "default cash floor" },
  marriottBonvoy: { centsPerPoint: 0.8, low: 0.6, high: 1.0, basis: "default" },
  mbnaRewards: { centsPerPoint: 1.0, floorCentsPerPoint: 0.833333, basis: "default cash floor" },
  ctMoney: { cadPerUnit: 1.0, optionalUsabilityFactor: 0.95, usabilityFactorApplied: true },
  cro: { model: "reward-currency", faceValueFactorIfAutoSold: 1.0, defaultHeldRiskFactor: 0.8 },
  cashBack: { cadPerDollar: 1.0 },
};

export function defaultOwnerState(contractCardIds: string[]): OwnerState | null {
  const ownedCardIds = [...new Set(contractCardIds)];
  if (ownedCardIds.length === 0) return null;
  return {
    ownerStateVersion: "default-1",
    ownedCardIds,
    defaultCardId: ownedCardIds[0],
    switchThreshold: DEFAULT_SWITCH_THRESHOLD,
    carry: { drawerCards: [] },
    cardStates: {},
    valuationsCad: FLOOR_VALUATIONS,
  };
}

type OwnerStateDb = Pick<Prisma.TransactionClient, "ownerStateRecord" | "creditCard">;

// Lazy provisioning at every read site: returns the existing record, creates
// a default one when the user has contract-linked cards, or null when there
// is nothing to score with yet (no cards → recommendations stay "unknown").
export async function ensureOwnerStateRecord(db: OwnerStateDb, userId: string) {
  const existing = await db.ownerStateRecord.findUnique({ where: { userId } });
  if (existing) return existing;

  const cards = await db.creditCard.findMany({
    where: { userId, contractCardId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { contractCardId: true },
  });
  const state = defaultOwnerState(cards.map((c) => c.contractCardId!));
  if (!state) return null;

  try {
    return await db.ownerStateRecord.create({
      data: { userId, stateData: state as unknown as Prisma.InputJsonValue },
    });
  } catch {
    // Concurrent request created it first (userId is unique) — use theirs.
    return db.ownerStateRecord.findUnique({ where: { userId } });
  }
}
