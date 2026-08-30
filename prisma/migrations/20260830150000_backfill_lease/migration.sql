ALTER TABLE "EmailConnection"
    ADD COLUMN "backfillLockedAt" TIMESTAMP(3),
    ADD COLUMN "backfillLockId" TEXT;

DROP INDEX "EmailConnection_backfill_idx";

CREATE INDEX "EmailConnection_backfill_claim_idx"
    ON "EmailConnection"("backfillRequestedAt", "id")
    INCLUDE ("backfillLockedAt")
    WHERE "backfillRequestedAt" IS NOT NULL
      AND "backfillCompletedAt" IS NULL;
