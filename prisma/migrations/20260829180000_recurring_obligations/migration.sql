-- CreateEnum
CREATE TYPE "AmountPatternKind" AS ENUM ('FIXED', 'VARIABLE', 'USAGE_BASED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ObligationLifecycleStatus" AS ENUM ('TRIALING', 'ACTIVE', 'CANCELLING', 'CANCELLED', 'LAPSED');

-- CreateEnum
CREATE TYPE "ObligationOrigin" AS ENUM ('DETECTED', 'USER', 'MIGRATED');

-- CreateEnum
CREATE TYPE "EvidenceRole" AS ENUM ('OCCURRENCE', 'CADENCE_FACT', 'CANCELLATION', 'TRIAL', 'PRICE_CHANGE');

-- CreateTable
CREATE TABLE "RecurringObligation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discriminator" TEXT NOT NULL DEFAULT '',
    "kind" TEXT,
    "merchantCanonicalId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "cadence" JSONB NOT NULL,
    "schedule" JSONB NOT NULL,
    "amountPattern" "AmountPatternKind" NOT NULL,
    "status" "ObligationLifecycleStatus",
    "nextExpectedDate" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL,
    "confidenceReasons" JSONB NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
    "origin" "ObligationOrigin" NOT NULL DEFAULT 'DETECTED',
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "dismissedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "dismissReason" TEXT,
    "decidedConfidence" DOUBLE PRECISION,
    "decidedReasons" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringObligationEvidence" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "emailTransactionId" TEXT,
    "role" "EvidenceRole" NOT NULL,
    "excludedByUser" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringObligationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringObligation_userId_status_nextExpectedDate_idx" ON "RecurringObligation"("userId", "status", "nextExpectedDate");

-- CreateIndex
CREATE INDEX "RecurringObligation_algorithmVersion_idx" ON "RecurringObligation"("algorithmVersion");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringObligation_userId_merchantCanonicalId_currency_dis_key" ON "RecurringObligation"("userId", "merchantCanonicalId", "currency", "discriminator");

-- CreateIndex
CREATE INDEX "RecurringObligationEvidence_obligationId_occurredAt_idx" ON "RecurringObligationEvidence"("obligationId", "occurredAt");

-- CreateIndex
CREATE INDEX "RecurringObligationEvidence_purchaseId_idx" ON "RecurringObligationEvidence"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringObligationEvidence_obligationId_purchaseId_key" ON "RecurringObligationEvidence"("obligationId", "purchaseId");

-- AddForeignKey
ALTER TABLE "RecurringObligation" ADD CONSTRAINT "RecurringObligation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringObligationEvidence" ADD CONSTRAINT "RecurringObligationEvidence_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "RecurringObligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
