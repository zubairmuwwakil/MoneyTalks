-- Per-bill card allocation (see docs/decisions — MBNA's 5x currently
-- blankets streaming/digitalMedia/memberships, masking the ambiguity in
-- Bill.category's coarse "subscriptions" bucket; both columns are additive
-- and nullable so every existing bill keeps working unchanged):
--   spendCategory — pins an engine spend category, overriding the derived
--     Bill.category mapping (src/lib/domain/bills/cardForBill.ts).
--   paymentCardId — the CreditCard the user actually pays this bill with.
--     Nullable FK; ON DELETE SET NULL so deleting a card never deletes the
--     bill it was allocated to (same pattern as WalletEvent.purchaseId /
--     EmailTransaction.purchaseId in 20260817160000_cross_source_purchase_merge).
ALTER TABLE "Bill" ADD COLUMN "spendCategory" TEXT;
ALTER TABLE "Bill" ADD COLUMN "paymentCardId" TEXT;

CREATE INDEX "Bill_paymentCardId_idx" ON "Bill"("paymentCardId");

ALTER TABLE "Bill" ADD CONSTRAINT "Bill_paymentCardId_fkey" FOREIGN KEY ("paymentCardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
