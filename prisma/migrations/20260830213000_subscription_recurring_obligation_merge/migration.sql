-- Canonical subscription support is additive. Subscription and
-- SubscriptionPayment remain immutable rollback material in this release.
CREATE TYPE "RecurringObligationOwnerFactType" AS ENUM (
  'CHARGE', 'EXPLICIT_CADENCE', 'NEXT_BILLING_DATE', 'PRICE_CHANGE',
  'TRIAL_STARTED', 'TRIAL_ENDED', 'ACTIVATION', 'CANCELLATION', 'RESUMPTION'
);
CREATE TYPE "RecurringObligationOwnerFactSource" AS ENUM (
  'OWNER_ACTION', 'MIGRATED_SUBSCRIPTION', 'MIGRATED_SUBSCRIPTION_PAYMENT'
);
CREATE TYPE "LegacySubscriptionMapOutcome" AS ENUM ('MERGED', 'CREATED');

ALTER TABLE "RecurringObligation"
  ALTER COLUMN "merchantCanonicalId" DROP NOT NULL,
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "cancellationUrl" TEXT,
  ADD COLUMN "cancelInstructions" TEXT;

DROP INDEX "RecurringObligation_identity_with_currency_key";
DROP INDEX "RecurringObligation_identity_without_currency_key";
CREATE UNIQUE INDEX "RecurringObligation_known_identity_with_currency_key"
  ON "RecurringObligation"("userId", "merchantCanonicalId", "currency", "discriminator", "seriesKey")
  WHERE "merchantCanonicalId" IS NOT NULL AND "currency" IS NOT NULL;
CREATE UNIQUE INDEX "RecurringObligation_known_identity_without_currency_key"
  ON "RecurringObligation"("userId", "merchantCanonicalId", "discriminator", "seriesKey")
  WHERE "merchantCanonicalId" IS NOT NULL AND "currency" IS NULL;
CREATE UNIQUE INDEX "RecurringObligation_unknown_identity_with_currency_key"
  ON "RecurringObligation"("userId", "currency", "discriminator", "seriesKey")
  WHERE "merchantCanonicalId" IS NULL AND "currency" IS NOT NULL;
CREATE UNIQUE INDEX "RecurringObligation_unknown_identity_without_currency_key"
  ON "RecurringObligation"("userId", "discriminator", "seriesKey")
  WHERE "merchantCanonicalId" IS NULL AND "currency" IS NULL;

CREATE TABLE "RecurringObligationOwnerFact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "type" "RecurringObligationOwnerFactType" NOT NULL,
  "source" "RecurringObligationOwnerFactSource" NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "billingAt" TIMESTAMP(3),
  "amountMinor" INTEGER,
  "currency" TEXT,
  "cadence" TEXT,
  "note" TEXT,
  "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringObligationOwnerFact_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LegacySubscriptionMapping" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "legacySubscriptionId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "outcome" "LegacySubscriptionMapOutcome" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "migratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacySubscriptionMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecurringObligationOwnerFact_supersedesId_key" ON "RecurringObligationOwnerFact"("supersedesId");
CREATE UNIQUE INDEX "RecurringObligationOwnerFact_obligationId_sourceKey_key" ON "RecurringObligationOwnerFact"("obligationId", "sourceKey");
CREATE INDEX "RecurringObligationOwnerFact_userId_obligationId_occurredAt_idx" ON "RecurringObligationOwnerFact"("userId", "obligationId", "occurredAt");
CREATE INDEX "RecurringObligationOwnerFact_obligationId_type_occurredAt_idx" ON "RecurringObligationOwnerFact"("obligationId", "type", "occurredAt");
CREATE UNIQUE INDEX "LegacySubscriptionMapping_legacySubscriptionId_key" ON "LegacySubscriptionMapping"("legacySubscriptionId");
CREATE UNIQUE INDEX "LegacySubscriptionMapping_obligationId_key" ON "LegacySubscriptionMapping"("obligationId");
CREATE INDEX "LegacySubscriptionMapping_userId_migratedAt_idx" ON "LegacySubscriptionMapping"("userId", "migratedAt");

ALTER TABLE "RecurringObligationOwnerFact"
  ADD CONSTRAINT "RecurringObligationOwnerFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringObligationOwnerFact_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "RecurringObligation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringObligationOwnerFact_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "RecurringObligationOwnerFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegacySubscriptionMapping"
  ADD CONSTRAINT "LegacySubscriptionMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacySubscriptionMapping_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "RecurringObligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
