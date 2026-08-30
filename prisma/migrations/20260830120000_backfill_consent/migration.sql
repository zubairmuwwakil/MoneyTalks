ALTER TABLE "EmailConnection" ADD COLUMN "backfillRequestedAt" TIMESTAMP(3);

CREATE INDEX "EmailConnection_backfill_idx"
    ON "EmailConnection"("backfillRequestedAt")
    WHERE "backfillCompletedAt" IS NULL;
