-- Complete-record capture: preserve the device's original timestamp string and
-- IANA timezone, exact decimal amounts, resolved identities, and the payload
-- as received. amountRaw moves Float -> Decimal; existing float values are
-- cast in place (their float imprecision is already baked in, new writes are exact).
ALTER TABLE "WalletEvent"
ADD COLUMN "capturedAtRaw" TEXT,
ADD COLUMN "capturedTimezone" TEXT,
ADD COLUMN "merchantNormalized" TEXT,
ADD COLUMN "resolvedCardId" TEXT,
ADD COLUMN "rawPayload" JSONB;

ALTER TABLE "WalletEvent" ALTER COLUMN "amountRaw" TYPE DECIMAL(15,4);
