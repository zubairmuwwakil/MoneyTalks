-- Lifecycle facts an email stated, captured at ingestion where the decoded
-- body is available. See docs/decisions/2026-08-30-email-fact-lane.md.

CREATE TYPE "EmailFactType" AS ENUM (
  'EXPLICIT_CADENCE',
  'EXPLICIT_RECURRING',
  'CANCELLATION',
  'TRIAL_STARTED',
  'TRIAL_ENDED',
  'PRICE_CHANGE',
  'NEXT_BILLING_DATE'
);

CREATE TABLE "EmailObligationFact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emailTransactionId" TEXT NOT NULL,
  "type" "EmailFactType" NOT NULL,
  "extractorId" TEXT NOT NULL,
  "extractorVersion" INTEGER NOT NULL DEFAULT 1,
  "factKey" TEXT NOT NULL DEFAULT '',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "billingAt" TIMESTAMP(3),
  "amountMinor" INTEGER,
  "currency" TEXT,
  "cadence" TEXT,
  "evidenceSnippet" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailObligationFact_pkey" PRIMARY KEY ("id")
);

-- The unique key carries factKey from the start: adding it later would be a
-- migration with a dedup step, because one message can state several facts of
-- one type (an Apple or Google Play receipt lists multiple subscriptions).
CREATE UNIQUE INDEX "EmailObligationFact_emailTransactionId_extractorId_type_fac_key"
  ON "EmailObligationFact"("emailTransactionId", "extractorId", "type", "factKey");

CREATE INDEX "EmailObligationFact_userId_type_effectiveAt_idx"
  ON "EmailObligationFact"("userId", "type", "effectiveAt");

CREATE INDEX "EmailObligationFact_userId_occurredAt_idx"
  ON "EmailObligationFact"("userId", "occurredAt");

-- Cascade on both parents: /api/data/delete performs prisma.user.delete and
-- relies wholly on cascade, so a missing rule fails account deletion.
ALTER TABLE "EmailObligationFact"
  ADD CONSTRAINT "EmailObligationFact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailObligationFact"
  ADD CONSTRAINT "EmailObligationFact_emailTransactionId_fkey"
  FOREIGN KEY ("emailTransactionId") REFERENCES "EmailTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
