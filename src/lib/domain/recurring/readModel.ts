import type { ObligationLifecycleStatus, Prisma } from "@prisma/client";

export const CADENCE_TYPES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"] as const;
export type CanonicalCadenceType = (typeof CADENCE_TYPES)[number];

export type RecurringReadRow = {
  id: string;
  displayName: string | null;
  merchantCanonicalId: string | null;
  currency: string | null;
  cadence: Prisma.JsonValue;
  schedule: Prisma.JsonValue;
  status: ObligationLifecycleStatus | null;
  nextExpectedDate: Date | null;
  lastObservedAt: Date;
  notes: string | null;
  cancellationUrl: string | null;
  cancelInstructions: string | null;
};

export function cadenceType(value: Prisma.JsonValue): CanonicalCadenceType | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && (CADENCE_TYPES as readonly string[]).includes(type)
    ? type as CanonicalCadenceType
    : null;
}

export function currentAmountMinor(value: Prisma.JsonValue): number | null {
  if (!Array.isArray(value)) return null;
  const entries = value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
    const entry = candidate as { from?: unknown; amountMinor?: unknown };
    return typeof entry.from === "string" && typeof entry.amountMinor === "number"
      ? [{ from: entry.from, amountMinor: entry.amountMinor }]
      : [];
  });
  return entries.sort((left, right) => left.from.localeCompare(right.from)).at(-1)?.amountMinor ?? null;
}

export function obligationName(row: Pick<RecurringReadRow, "displayName" | "merchantCanonicalId">): string {
  return row.displayName ?? row.merchantCanonicalId ?? "Subscription";
}

export function isRenewalRelevant(status: ObligationLifecycleStatus | null): boolean {
  return status === "ACTIVE" || status === "TRIALING" || status === "CANCELLING";
}

export function canonicalSubscriptionView(row: RecurringReadRow) {
  return {
    id: row.id,
    name: obligationName(row),
    amountMinor: currentAmountMinor(row.schedule),
    currency: row.currency,
    nextBillingAt: row.nextExpectedDate,
    cadence: cadenceType(row.cadence),
    lifecycleStatus: row.status,
    notes: row.notes,
    cancellationUrl: row.cancellationUrl,
    cancelInstructions: row.cancelInstructions,
    merchantCanonicalId: row.merchantCanonicalId,
  };
}

/**
 * Deliberately lossy compatibility projection. Only adapters may call this;
 * canonical UI and domain code consume lifecycleStatus directly.
 */
export function legacySubscriptionProjection(
  row: RecurringReadRow & {
    legacySubscription?: { legacySubscriptionId: string } | null;
    ownerFacts?: Array<{ type: string; effectiveAt: Date | null; occurredAt: Date }>;
  },
) {
  const type = cadenceType(row.cadence);
  const trialEndAt = row.ownerFacts
    ?.filter((fact) => fact.type === "TRIAL_ENDED")
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    .at(-1)?.effectiveAt ?? null;
  return {
    id: row.legacySubscription?.legacySubscriptionId ?? row.id,
    canonicalId: row.id,
    name: obligationName(row),
    amountCents: currentAmountMinor(row.schedule) ?? 0,
    currency: row.currency ?? "",
    renewalDate: row.nextExpectedDate,
    cadence: type === "MONTHLY" ? "MONTHLY" as const : type === "ANNUAL" ? "YEARLY" as const : "CUSTOM" as const,
    status: row.status === "CANCELLED" ? "CANCELLED" as const : "ACTIVE" as const,
    lifecycleStatus: row.status,
    notes: row.notes,
    cancelUrl: row.cancellationUrl,
    cancelInstructions: row.cancelInstructions,
    merchantCanonicalId: row.merchantCanonicalId,
    trialEndAt,
  };
}
