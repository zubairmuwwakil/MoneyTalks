/**
 * Additive, bounded Subscription -> RecurringObligation backfill.
 *
 * Dry-run by default. It never modifies legacy tables and records only opaque
 * ids and aggregate outcomes. Run per owner with --apply after the additive
 * migration is deployed; never point this at production casually.
 */
import { parseArgs } from "node:util";
import { PrismaClient, type Prisma } from "@prisma/client";

const db = new PrismaClient();
const BATCH_SIZE = 100;

type LegacySubscription = {
  id: string; userId: string; name: string; amountCents: number; currency: string;
  renewalDate: Date; cadence: "MONTHLY" | "YEARLY" | "CUSTOM"; status: "ACTIVE" | "CANCELLED";
  cancelUrl: string | null; notes: string | null; trialEndAt: Date | null; cancelInstructions: string | null;
  merchantCanonicalId: string | null; createdAt: Date; updatedAt: Date;
};

type Counts = Record<"created" | "merged" | "ambiguous" | "nullMerchant" | "customCadence" | "payments", number>;
const emptyCounts = (): Counts => ({ created: 0, merged: 0, ambiguous: 0, nullMerchant: 0, customCadence: 0, payments: 0 });

function inferredCadence(subscription: LegacySubscription) {
  return subscription.cadence === "YEARLY" ? "ANNUAL" : "MONTHLY";
}

function cadenceJson(cadence: "MONTHLY" | "ANNUAL", anchor: Date): Prisma.InputJsonValue {
  const iso = anchor.toISOString().slice(0, 10);
  return cadence === "MONTHLY"
    ? { type: cadence, dayOfMonth: anchor.getUTCDate(), startsFrom: iso }
    : { type: cadence, anchor: iso };
}

function sameCadence(value: Prisma.JsonValue, expected: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as { type?: unknown }).type === expected;
}

function currentAmount(value: Prisma.JsonValue): number | null {
  if (!Array.isArray(value)) return null;
  const latest = value.at(-1);
  return typeof latest === "object" && latest !== null && typeof (latest as { amountMinor?: unknown }).amountMinor === "number"
    ? (latest as { amountMinor: number }).amountMinor : null;
}

function materiallyCompatible(left: number | null, right: number): boolean {
  return left !== null && Math.abs(left - right) <= Math.max(1, Math.round(right * 0.01));
}

function withinCadenceTolerance(next: Date | null, renewal: Date, cadence: string): boolean {
  if (!next) return false;
  const days = Math.abs(next.getTime() - renewal.getTime()) / 86_400_000;
  return days <= (cadence === "ANNUAL" ? 31 : 5);
}

async function migrateOne(subscription: LegacySubscription, apply: boolean, counts: Counts) {
  const existingMap = await db.legacySubscriptionMapping.findUnique({ where: { legacySubscriptionId: subscription.id } });
  if (existingMap) return;
  const cadence = inferredCadence(subscription);
  if (!subscription.merchantCanonicalId) counts.nullMerchant += 1;
  if (subscription.cadence === "CUSTOM") counts.customCadence += 1;
  const candidates = subscription.merchantCanonicalId ? await db.recurringObligation.findMany({
    where: { userId: subscription.userId, merchantCanonicalId: subscription.merchantCanonicalId, currency: subscription.currency },
    select: { id: true, cadence: true, schedule: true, nextExpectedDate: true },
  }) : [];
  const exact = candidates.filter((candidate) => (
    sameCadence(candidate.cadence, cadence)
    && materiallyCompatible(currentAmount(candidate.schedule), subscription.amountCents)
    && withinCadenceTolerance(candidate.nextExpectedDate, subscription.renewalDate, cadence)
  ));
  if (exact.length > 1) { counts.ambiguous += 1; return; }
  const outcome = exact.length === 1 ? "MERGED" as const : "CREATED" as const;
  if (outcome === "MERGED") counts.merged += 1; else counts.created += 1;
  const payments = await db.subscriptionPayment.findMany({ where: { userId: subscription.userId, subscriptionId: subscription.id } });
  counts.payments += payments.length;
  if (!apply) return;

  await db.$transaction(async (tx) => {
    const obligation = exact[0] ? await tx.recurringObligation.findUniqueOrThrow({ where: { id: exact[0].id } })
      : await tx.recurringObligation.create({ data: {
        userId: subscription.userId, kind: "SUBSCRIPTION", origin: "MIGRATED", needsReview: subscription.cadence === "CUSTOM",
        displayName: subscription.name, notes: subscription.notes, cancellationUrl: subscription.cancelUrl,
        cancelInstructions: subscription.cancelInstructions, merchantCanonicalId: subscription.merchantCanonicalId,
        currency: subscription.currency, discriminator: "", seriesKey: `legacy:${subscription.id}`,
        cadence: cadenceJson(cadence, subscription.renewalDate),
        schedule: [{ amountMinor: subscription.amountCents, from: subscription.renewalDate.toISOString().slice(0, 10) }],
        amountPattern: "FIXED", status: subscription.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
        nextExpectedDate: subscription.renewalDate, confidence: 1, confidenceReasons: [], lastObservedAt: subscription.updatedAt, algorithmVersion: 1,
      } });
    if (outcome === "MERGED") await tx.recurringObligation.update({ where: { id: obligation.id }, data: {
      displayName: obligation.displayName || subscription.name, notes: obligation.notes || subscription.notes,
      cancellationUrl: obligation.cancellationUrl || subscription.cancelUrl,
      cancelInstructions: obligation.cancelInstructions || subscription.cancelInstructions,
    } });
    const source = "MIGRATED_SUBSCRIPTION" as const;
    const facts = [
      { type: "PRICE_CHANGE" as const, sourceKey: `legacy:${subscription.id}:price`, occurredAt: subscription.createdAt, amountMinor: subscription.amountCents, currency: subscription.currency },
      { type: "NEXT_BILLING_DATE" as const, sourceKey: `legacy:${subscription.id}:next`, occurredAt: subscription.createdAt, billingAt: subscription.renewalDate },
      { type: "EXPLICIT_CADENCE" as const, sourceKey: `legacy:${subscription.id}:cadence`, occurredAt: subscription.createdAt, cadence },
      { type: subscription.status === "CANCELLED" ? "CANCELLATION" as const : "ACTIVATION" as const, sourceKey: `legacy:${subscription.id}:lifecycle`, occurredAt: subscription.status === "CANCELLED" ? subscription.updatedAt : subscription.createdAt },
      ...(subscription.trialEndAt ? [{ type: "TRIAL_ENDED" as const, sourceKey: `legacy:${subscription.id}:trial-end`, occurredAt: subscription.createdAt, effectiveAt: subscription.trialEndAt }] : []),
    ];
    await tx.recurringObligationOwnerFact.createMany({ data: facts.map((fact) => ({ userId: subscription.userId, obligationId: obligation.id, source, ...fact })), skipDuplicates: true });
    await tx.recurringObligationOwnerFact.createMany({ data: payments.map((payment) => ({
      userId: subscription.userId, obligationId: obligation.id, type: "CHARGE" as const, source: "MIGRATED_SUBSCRIPTION_PAYMENT" as const,
      sourceKey: `legacy-payment:${payment.id}`, occurredAt: payment.paidAt, amountMinor: payment.amountCents, currency: payment.currency, note: payment.notes,
    })), skipDuplicates: true });
    await tx.legacySubscriptionMapping.create({ data: { userId: subscription.userId, legacySubscriptionId: subscription.id, obligationId: obligation.id, outcome, reasonCode: outcome === "MERGED" ? "EXACT_MATCH" : subscription.merchantCanonicalId ? "NO_EXACT_MATCH" : "NULL_MERCHANT" } });
  });
}

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false }, user: { type: "string" }, limit: { type: "string" } } });
  const limit = Math.min(Number(values.limit ?? BATCH_SIZE), BATCH_SIZE);
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be 1 through 100");
  const mappings = await db.legacySubscriptionMapping.findMany({
    where: values.user ? { userId: values.user } : undefined,
    select: { legacySubscriptionId: true },
  });
  const rows = await db.subscription.findMany({
    where: {
      ...(values.user ? { userId: values.user } : {}),
      id: { notIn: mappings.map(({ legacySubscriptionId }) => legacySubscriptionId) },
    },
    take: limit,
    orderBy: { id: "asc" },
  }) as LegacySubscription[];
  const counts = emptyCounts();
  for (const row of rows) await migrateOne(row, values.apply, counts);
  console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", scanned: rows.length, ...counts }));
}

main().finally(() => db.$disconnect());
