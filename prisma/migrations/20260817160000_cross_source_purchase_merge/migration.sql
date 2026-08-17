-- Cross-source merge: raw observations (WalletEvent, EmailTransaction) link
-- to their canonical Purchase; near-matches are flagged, never silently
-- merged. Backfill derives links from the legacy source columns. sourceEventId
-- was already present in the Prisma model, but was missing from the historical
-- SQL migrations, so it must be created before the wallet backfill can use it.
ALTER TABLE "Purchase" ADD COLUMN "possibleDuplicateOfId" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "sourceEventId" TEXT;
CREATE UNIQUE INDEX "Purchase_userId_sourceEventId_key" ON "Purchase"("userId", "sourceEventId");

ALTER TABLE "WalletEvent" ADD COLUMN "purchaseId" TEXT;
ALTER TABLE "WalletEvent" ADD CONSTRAINT "WalletEvent_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WalletEvent_purchaseId_idx" ON "WalletEvent"("purchaseId");

ALTER TABLE "EmailTransaction" ADD COLUMN "purchaseId" TEXT;
ALTER TABLE "EmailTransaction" ADD CONSTRAINT "EmailTransaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "EmailTransaction_purchaseId_idx" ON "EmailTransaction"("purchaseId");

UPDATE "WalletEvent" we SET "purchaseId" = p."id"
FROM "Purchase" p
WHERE p."userId" = we."userId" AND p."source" = 'WALLET' AND p."sourceEventId" = we."eventId";

UPDATE "EmailTransaction" et SET "purchaseId" = p."id"
FROM "Purchase" p
WHERE p."userId" = et."userId" AND p."sourceEmailId" = et."messageId";
