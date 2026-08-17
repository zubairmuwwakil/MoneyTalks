-- Phase 3e: connect a user's card to the capture/scoring contract and retain
-- only compact monthly coverage metrics, never imported statement rows.
ALTER TABLE "CreditCard" ADD COLUMN "contractCardId" TEXT;

CREATE INDEX "CreditCard_userId_contractCardId_idx" ON "CreditCard"("userId", "contractCardId");

CREATE TABLE "CoverageReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "matchedLines" INTEGER NOT NULL,
    "eligibleLines" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoverageReport_cardId_month_key" ON "CoverageReport"("cardId", "month");
CREATE INDEX "CoverageReport_userId_cardId_month_idx" ON "CoverageReport"("userId", "cardId", "month");

ALTER TABLE "CoverageReport" ADD CONSTRAINT "CoverageReport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoverageReport" ADD CONSTRAINT "CoverageReport_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
