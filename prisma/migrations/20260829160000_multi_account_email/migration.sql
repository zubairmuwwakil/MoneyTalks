-- A connection whose address we never learned cannot be told apart from
-- another one. Keep the row and its tokens (deleting an owner's grant is
-- not a migration's decision) but give it a visibly invalid address so the
-- settings UI shows it as needing reconnection.
UPDATE "EmailConnection"
   SET "emailAddress" = 'unknown+' || "id" || '@invalid'
 WHERE "emailAddress" IS NULL;

ALTER TABLE "EmailConnection" ALTER COLUMN "emailAddress" SET NOT NULL;
DROP INDEX IF EXISTS "EmailConnection_userId_key";
CREATE UNIQUE INDEX "EmailConnection_userId_provider_emailAddress_key"
    ON "EmailConnection"("userId", "provider", "emailAddress");
CREATE INDEX "EmailConnection_userId_idx" ON "EmailConnection"("userId");

ALTER TABLE "EmailConnection" ADD COLUMN "backfillCursor" TEXT;
ALTER TABLE "EmailConnection" ADD COLUMN "backfillCompletedAt" TIMESTAMP(3);
ALTER TABLE "EmailConnection" ADD COLUMN "lastScanError" TEXT;

ALTER TABLE "EmailTransaction" ADD COLUMN "connectionId" TEXT;
ALTER TABLE "EmailTransaction" ADD COLUMN "rfc822MessageId" TEXT;
ALTER TABLE "EmailTransaction"
  ADD CONSTRAINT "EmailTransaction_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "EmailConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "EmailTransaction_userId_rfc822MessageId_idx"
    ON "EmailTransaction"("userId", "rfc822MessageId");

-- Existing transactions belong to the owner's only connection.
UPDATE "EmailTransaction" t
   SET "connectionId" = c."id"
  FROM "EmailConnection" c
 WHERE c."userId" = t."userId";
