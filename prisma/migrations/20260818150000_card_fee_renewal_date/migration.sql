-- Annual-fee decision timing. feeMonthDay is a recurring "MM-DD" anniversary
-- rather than a DateTime so it never goes stale; feeCancelGraceDays is the
-- issuer window during which cancelling still recovers the fee.
ALTER TABLE "CreditCard" ADD COLUMN "feeMonthDay" TEXT;
ALTER TABLE "CreditCard" ADD COLUMN "feeCancelGraceDays" INTEGER NOT NULL DEFAULT 30;
