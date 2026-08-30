-- An owner answer about a merchant is personal evidence, never a global
-- merchant attribute: Netflix can bill one owner in CAD and another in USD.
CREATE TABLE "MerchantCurrencyConfirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantCanonicalId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantCurrencyConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantCurrencyConfirmation_userId_merchantCanonicalId_key"
ON "MerchantCurrencyConfirmation"("userId", "merchantCanonicalId");

CREATE INDEX "MerchantCurrencyConfirmation_userId_idx"
ON "MerchantCurrencyConfirmation"("userId");

ALTER TABLE "MerchantCurrencyConfirmation"
ADD CONSTRAINT "MerchantCurrencyConfirmation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PostgreSQL considers NULL values distinct in a normal unique index. A null
-- currency is a real identity only for an entirely unpriced series, so retain
-- uniqueness with one partial index for each domain instead of allowing a
-- rerun to duplicate its null-currency obligation.
DROP INDEX "RecurringObligation_userId_merchantCanonicalId_currency_dis_key";

ALTER TABLE "RecurringObligation" ALTER COLUMN "currency" DROP NOT NULL;

CREATE UNIQUE INDEX "RecurringObligation_identity_with_currency_key"
ON "RecurringObligation"("userId", "merchantCanonicalId", "currency", "discriminator")
WHERE "currency" IS NOT NULL;

CREATE UNIQUE INDEX "RecurringObligation_identity_without_currency_key"
ON "RecurringObligation"("userId", "merchantCanonicalId", "discriminator")
WHERE "currency" IS NULL;
