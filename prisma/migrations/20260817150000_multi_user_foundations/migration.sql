-- Multi-user foundations: CardAlias becomes per-user (the same raw device
-- string can mean different physical cards for different users). Existing
-- rows belong to the original single user; on a fresh DB both tables are
-- empty and every statement no-ops. Also drops the dead v1 marker.
ALTER TABLE "CardAlias" ADD COLUMN "userId" TEXT;
UPDATE "CardAlias" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);
DELETE FROM "CardAlias" WHERE "userId" IS NULL;
ALTER TABLE "CardAlias" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX "CardAlias_rawString_key";
CREATE UNIQUE INDEX "CardAlias_userId_rawString_key" ON "CardAlias"("userId", "rawString");
ALTER TABLE "CardAlias" ADD CONSTRAINT "CardAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OwnerStateRecord" DROP COLUMN "isV1SingleUser";
