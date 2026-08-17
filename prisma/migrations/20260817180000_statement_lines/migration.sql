-- Statement lines become a persisted third observation source (previously
-- ephemeral by design; complete-record posture keeps them). lineHash makes
-- re-uploads idempotent per user.
CREATE TABLE "StatementLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "purchaseId" TEXT,
    "walletEventId" TEXT,
    "lineHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatementLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StatementLine_userId_lineHash_key" ON "StatementLine"("userId", "lineHash");
CREATE INDEX "StatementLine_userId_date_idx" ON "StatementLine"("userId", "date");
CREATE INDEX "StatementLine_purchaseId_idx" ON "StatementLine"("purchaseId");

ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
