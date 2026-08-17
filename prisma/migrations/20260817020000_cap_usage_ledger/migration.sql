-- Phase 3d: cap use is measured from normalized purchase sources, rather than
-- only from the owner-state seed.
ALTER TABLE "Purchase" ADD COLUMN "category" TEXT;
ALTER TABLE "MerchantAlias" ADD COLUMN "category" TEXT;

CREATE TABLE "CapUsageLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "capId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "usedMinor" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapUsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CapAccrual" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "capId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "usedMinor" INTEGER NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapAccrual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapUsageLedger_userId_cardId_capId_periodKey_key" ON "CapUsageLedger"("userId", "cardId", "capId", "periodKey");
CREATE INDEX "CapUsageLedger_userId_capId_periodKey_idx" ON "CapUsageLedger"("userId", "capId", "periodKey");
CREATE UNIQUE INDEX "CapAccrual_sourceKey_key" ON "CapAccrual"("sourceKey");
CREATE INDEX "CapAccrual_userId_cardId_capId_periodKey_idx" ON "CapAccrual"("userId", "cardId", "capId", "periodKey");

ALTER TABLE "CapUsageLedger" ADD CONSTRAINT "CapUsageLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CapAccrual" ADD CONSTRAINT "CapAccrual_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
