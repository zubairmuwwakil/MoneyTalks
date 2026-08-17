import { createHash } from "node:crypto";
import type { ReconciliationStatus } from "@/engine/statement-reconciliation";

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

// A tolerance decision is the user's, and re-uploading the same statement must
// not quietly take it back. Line hashes are stable across uploads, so the engine
// recomputes "matched-tolerant" every time and would otherwise overwrite a
// confirm or a reject on the next upload. Decisions therefore outrank guesses:
// only a tolerant recomputation defers, and only to a status a user could have
// set. Everything else — including a line whose amount or description changed,
// which hashes to a different row anyway — takes the fresh engine result.
const USER_DECIDED: ReadonlySet<string> = new Set(["matched", "rejected"]);

export function applyUserDecision(
  computed: ReconciliationStatus,
  persisted: string | null | undefined,
): ReconciliationStatus {
  if (computed !== "matched-tolerant") return computed;
  return persisted && USER_DECIDED.has(persisted) ? (persisted as ReconciliationStatus) : computed;
}

/**
 * The purchases a reconciliation run may mark RECONCILED. Only exact matches
 * qualify: a tolerant match keeps its candidate link on the statement line but
 * is a proposal, not evidence, until the user confirms it (which rewrites the
 * line to "matched" and brings it here on the next pass).
 */
export function purchaseIdsToReconcile(
  lines: ReadonlyArray<{ status: ReconciliationStatus; purchaseId: string | null }>,
): string[] {
  return [...new Set(lines.flatMap((line) => (line.status === "matched" && line.purchaseId ? [line.purchaseId] : [])))];
}
