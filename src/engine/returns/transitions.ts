/** The persisted return lifecycle. Keep this independent of Prisma so it stays pure. */
export type ReturnStatus = "NOT_STARTED" | "PACKED" | "DROPPED_OFF" | "DELIVERED" | "REFUNDED";

const ORDER: readonly ReturnStatus[] = ["NOT_STARTED", "PACKED", "DROPPED_OFF", "DELIVERED", "REFUNDED"];

/**
 * A return may move forward by one or more stages. Repeating its current stage
 * is intentionally allowed so command endpoints remain idempotent.
 */
export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  if (from === "REFUNDED") return to === "REFUNDED";
  return ORDER.indexOf(to) >= ORDER.indexOf(from);
}
