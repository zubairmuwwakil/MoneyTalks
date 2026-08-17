-- Keep-separate duplicate decisions must survive flag clearing so scheduled
-- matching cannot offer the same pair repeatedly. Application code stores the
-- two purchase ids in lexical order, making the unique key order-independent.
CREATE TABLE "PurchaseDuplicateDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseLowId" TEXT NOT NULL,
    "purchaseHighId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDuplicateDismissal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseDuplicateDismissal_distinct_pair_check" CHECK ("purchaseLowId" <> "purchaseHighId")
);

CREATE UNIQUE INDEX "PurchaseDuplicateDismissal_userId_purchaseLowId_purchaseHighId_key"
  ON "PurchaseDuplicateDismissal"("userId", "purchaseLowId", "purchaseHighId");
CREATE INDEX "PurchaseDuplicateDismissal_purchaseLowId_idx"
  ON "PurchaseDuplicateDismissal"("purchaseLowId");
CREATE INDEX "PurchaseDuplicateDismissal_purchaseHighId_idx"
  ON "PurchaseDuplicateDismissal"("purchaseHighId");
-- The sweep scans recent purchases across all users; the existing
-- (userId, purchasedAt) index cannot serve that global time-range query.
CREATE INDEX "Purchase_purchasedAt_idx" ON "Purchase"("purchasedAt");

ALTER TABLE "PurchaseDuplicateDismissal" ADD CONSTRAINT "PurchaseDuplicateDismissal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseDuplicateDismissal" ADD CONSTRAINT "PurchaseDuplicateDismissal_purchaseLowId_fkey"
  FOREIGN KEY ("purchaseLowId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseDuplicateDismissal" ADD CONSTRAINT "PurchaseDuplicateDismissal_purchaseHighId_fkey"
  FOREIGN KEY ("purchaseHighId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
