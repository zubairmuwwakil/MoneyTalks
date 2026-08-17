import { createHash } from "node:crypto";

// Identity for a statement line across re-uploads: same card, same day, same
// amount, same (normalized) description = the same line. Scoped per-user via
// the [userId, lineHash] unique constraint.
export function statementLineHash(input: {
  cardId: string;
  date: string; // yyyy-mm-dd
  description: string;
  amountMinor: number;
}): string {
  const normalized = `${input.cardId}|${input.date}|${input.amountMinor}|${input.description.trim().toLowerCase()}`;
  return createHash("sha256").update(normalized).digest("hex");
}

// Reconciliation candidates are id-tagged "purchase:{id}" | "wallet:{id}".
export function parseCandidateId(candidateId: string | undefined): {
  purchaseId: string | null;
  walletEventId: string | null;
} {
  if (candidateId?.startsWith("purchase:")) {
    return { purchaseId: candidateId.slice("purchase:".length), walletEventId: null };
  }
  if (candidateId?.startsWith("wallet:")) {
    return { purchaseId: null, walletEventId: candidateId.slice("wallet:".length) };
  }
  return { purchaseId: null, walletEventId: null };
}
