-- Foreign spend now converts into the CAD cap ledger using the user's own
-- stored FX rates, so each accrual records what was observed and the rate that
-- was applied. Without this an accrued figure cannot be audited or recomputed.
--
-- Nullable throughout: accruals written before conversion existed were CAD-only
-- by construction, and their original currency cannot be recovered after the
-- fact. Null here means "not recorded", never "CAD".
ALTER TABLE "CapAccrual" ADD COLUMN "sourceAmountMinor" INTEGER;
ALTER TABLE "CapAccrual" ADD COLUMN "sourceCurrency" TEXT;
ALTER TABLE "CapAccrual" ADD COLUMN "fxRate" DECIMAL(65,30);
ALTER TABLE "CapAccrual" ADD COLUMN "fxRateAsOf" TIMESTAMP(3);
