CREATE TYPE "PurchaseFinancialState" AS ENUM ('NORMALIZED', 'RECONCILED', 'ADJUSTED', 'DECLINED', 'REVERSED');
CREATE TYPE "WalletEventFinancialState" AS ENUM ('CAPTURED', 'NORMALIZED', 'RECONCILED', 'ADJUSTED', 'DECLINED', 'REVERSED');
ALTER TABLE "Purchase" ADD COLUMN "financialState" "PurchaseFinancialState" NOT NULL DEFAULT 'NORMALIZED';
ALTER TABLE "WalletEvent" ADD COLUMN "financialState" "WalletEventFinancialState" NOT NULL DEFAULT 'CAPTURED';
CREATE TABLE "PurchaseCorrection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "beforeState" JSONB NOT NULL,
    "afterState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    CONSTRAINT "PurchaseCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseCorrection_userId_purchaseId_createdAt_idx" ON "PurchaseCorrection"("userId", "purchaseId", "createdAt");
ALTER TABLE "PurchaseCorrection" ADD CONSTRAINT "PurchaseCorrection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseCorrection" ADD CONSTRAINT "PurchaseCorrection_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
