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
type OwnerStateRecordRow = NonNullable<Awaited<ReturnType<OwnerStateDb["ownerStateRecord"]["findUnique"]>>>;

async function fetchContractCardIds(db: OwnerStateDb, userId: string): Promise<string[]> {
  const cards = await db.creditCard.findMany({
    where: { userId, contractCardId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { contractCardId: true },
  });
  return cards.map((c) => c.contractCardId!);
}

// Minimal structural check on persisted JSON — deliberately shallow. The
// only fields this module ever reads or writes are ownedCardIds/defaultCardId;
// everything else (switchThreshold, valuationsCad, cardStates, carry,
// ownerStateVersion) is passed through untouched, so it's never validated
// here. Anything that fails this check is treated as unusable, the same
// "absent, not crashing" posture src/lib/security/emailConnectionSecrets.ts
// takes for an undecryptable credential.
function extractOwnedIds(stateData: Prisma.JsonValue): { ownedCardIds: string[]; deletedCardIds?: string[]; defaultCardId: string } | null {
  if (stateData === null || typeof stateData !== "object" || Array.isArray(stateData)) return null;
  const { ownedCardIds, deletedCardIds, defaultCardId } = stateData as Record<string, unknown>;
  if (!Array.isArray(ownedCardIds) || !ownedCardIds.every((id) => typeof id === "string")) return null;
  if (typeof defaultCardId !== "string") return null;
  let deleted: string[] | undefined = undefined;
  if (Array.isArray(deletedCardIds) && deletedCardIds.every((id) => typeof id === "string")) {
    deleted = deletedCardIds as string[];
  }
  return { ownedCardIds: ownedCardIds as string[], deletedCardIds: deleted, defaultCardId };
}

/**
 * Reconciles a previously-persisted OwnerStateRecord's `ownedCardIds` against
 * the user's *current* contract-linked CreditCard rows.
 *
 * This is an additive UNION, not a resync, and that asymmetry is deliberate —
 * do not "simplify" it into recomputing ownedCardIds from CreditCard rows:
 *
 *   - A CreditCard.contractCardId we can see is proof the card is owned:
 *     safe to add.
 *   - The ABSENCE of a matching CreditCard row is NOT proof the card is
 *     unowned. The iOS app (PUT /api/spine/owner-state) writes
 *     `ownedCardIds` straight from its wallet picker, and an iOS-only user
 *     can have a fully populated owner state with zero web CreditCard rows.
 *     Dropping any stored id we can't currently back with a web row would
 *     silently wipe that user's wallet and every recommendation on it.
 *
 * An addition is provable from data we can see; a removal never is. So ids
 * only ever get added here, never removed.
 *
 * `defaultCardId` is kept a member of the (possibly widened) set: if the
 * stored default fell outside it — corrupt or legacy data — it's repointed
 * to the first id deterministically. A still-valid default is left alone.
 */
async function reconcileOwnedCards(db: OwnerStateDb, record: OwnerStateRecordRow): Promise<OwnerStateRecordRow> {
  const parsed = extractOwnedIds(record.stateData);
  if (!parsed) {
    console.warn(`[ownerState] unusable stateData for user ${record.userId}; skipping reconciliation`);
    return record;
  }

  const contractCardIds = await fetchContractCardIds(db, record.userId);

  const seen = new Set<string>();
  const ownedCardIds: string[] = [];
  for (const id of parsed.ownedCardIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ownedCardIds.push(id);
    }
  }
  for (const id of contractCardIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ownedCardIds.push(id);
    }
  }

  // Repoint only if the stored default fell outside the union — never
  // gratuitously move a default that's still valid.
  const defaultCardId = seen.has(parsed.defaultCardId) ? parsed.defaultCardId : ownedCardIds[0];
  const deletedCardIds = (parsed.deletedCardIds ?? []).filter((id) => !seen.has(id));

  const idsUnchanged =
    ownedCardIds.length === parsed.ownedCardIds.length &&
    ownedCardIds.every((id, i) => id === parsed.ownedCardIds[i]) &&
    (parsed.deletedCardIds ?? []).length === deletedCardIds.length;
  if (idsUnchanged && defaultCardId === parsed.defaultCardId) {
    return record; // Nothing to add, no drift to repair — skip the write.
  }

  const rawCardStates = extractCardStates(record.stateData);
  const cardStates: Record<string, unknown> = {};
  const deletedSet = new Set(deletedCardIds);
  for (const [id, state] of Object.entries(rawCardStates)) {
    if (!deletedSet.has(id)) {
      cardStates[id] = state;
    }
  }

  const nextStateData = {
    ...(record.stateData as Record<string, unknown>),
    ownedCardIds,
    deletedCardIds,
    defaultCardId,
    cardStates,
  };

  // Optimistic concurrency, not a transaction: `updateMany` filtered on the
  // `updatedAt` we read doubles as a version token (Prisma manages
  // `@updatedAt` on every write, so no schema change needed). If another
  // writer — a concurrent reconciliation pass from a simultaneous request,
  // or an iOS PUT replacing the whole state — landed first, this simply
  // matches zero rows instead of throwing or clobbering their write. Either
  // way we re-read and hand back whatever is current: this function is
  // idempotent (it recomputes the union fresh every call), so a lost race
  // here just means the next read repeats the reconciliation and converges,
  // rather than corrupting anything now.
  await db.ownerStateRecord.updateMany({
    where: { userId: record.userId, updatedAt: record.updatedAt },
    data: { stateData: nextStateData as unknown as Prisma.InputJsonValue },
  });
  const latest = await db.ownerStateRecord.findUnique({ where: { userId: record.userId } });
  return latest ?? record;
}

// Lazy provisioning at every read site: returns the existing record (after
// reconciling it — see reconcileOwnedCards above), creates a default one
// when the user has contract-linked cards, or null when there is nothing to
// score with yet (no cards → recommendations stay "unknown").
export async function ensureOwnerStateRecord(db: OwnerStateDb, userId: string) {
  const existing = await db.ownerStateRecord.findUnique({ where: { userId } });
  if (existing) return reconcileOwnedCards(db, existing);

  const contractCardIds = await fetchContractCardIds(db, userId);
  const state = defaultOwnerState(contractCardIds);
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

// ---------------------------------------------------------------------------
// 2. State-merging logic (PUT /api/spine/owner-state)
// ---------------------------------------------------------------------------

export type MergeableOwnerState = {
  ownedCardIds: string[];
  deletedCardIds?: string[];
  defaultCardId: string;
  cardStates: Record<string, unknown>;
};

function extractCardStates(stateData: unknown): Record<string, unknown> {
  if (stateData === null || typeof stateData !== "object" || Array.isArray(stateData)) return {};
  const { cardStates } = stateData as Record<string, unknown>;
  if (cardStates === null || typeof cardStates !== "object" || Array.isArray(cardStates)) return {};
  return cardStates as Record<string, unknown>;
}

export function mergeOwnerState<T extends MergeableOwnerState>(stored: unknown, incoming: T): T {
  const prior = extractOwnedIds(stored as Prisma.JsonValue);
  // Unusable stored data is treated as absent rather than fatal — the same
  // posture extractOwnedIds already takes for a corrupt record. Refusing the
  // write instead would strand a user behind data they cannot reach to fix.
  if (!prior) return incoming;

  const deletedSet = new Set([...(prior.deletedCardIds || []), ...(incoming.deletedCardIds || [])]);
  
  // If the user re-adds a card, they will put it in incoming.ownedCardIds.
  // We remove it from the tombstone set so it can be resurrected.
  // Note: this means a stale phone upload could resurrect a web-deleted card, 
  // but it's the best heuristic without per-card timestamps.
  for (const id of incoming.ownedCardIds) {
    deletedSet.delete(id);
  }

  const ownedCardIds: string[] = [];
  const seen = new Set<string>();
  for (const id of [...prior.ownedCardIds, ...incoming.ownedCardIds]) {
    if (deletedSet.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ownedCardIds.push(id);
  }

  const defaultCardId = ownedCardIds.length === 0
    ? ""
    : seen.has(incoming.defaultCardId)
      ? incoming.defaultCardId
      : seen.has(prior.defaultCardId)
        ? prior.defaultCardId
        : ownedCardIds[0];

  const rawCardStates = { ...extractCardStates(stored), ...incoming.cardStates };
  const cardStates: Record<string, unknown> = {};
  for (const [id, state] of Object.entries(rawCardStates)) {
    if (!deletedSet.has(id)) {
      cardStates[id] = state;
    }
  }

  return {
    ...incoming,
    ownedCardIds,
    deletedCardIds: Array.from(deletedSet),
    defaultCardId,
    cardStates,
  };
}
