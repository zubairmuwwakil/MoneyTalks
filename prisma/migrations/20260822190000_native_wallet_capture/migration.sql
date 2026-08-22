ALTER TYPE "WalletEventProcessingStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE';

ALTER TABLE "WalletEvent"
ADD COLUMN "captureVersion" INTEGER,
ADD COLUMN "transport" TEXT,
ADD COLUMN "amountTextRaw" TEXT,
ADD COLUMN "amountDeviceDecimal" DECIMAL(15,4),
ADD COLUMN "amountDecodeStatus" TEXT,
ADD COLUMN "amountDisagreement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paymentMethodRaw" TEXT,
ADD COLUMN "paymentMethodFallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "locationCapturedAt" TIMESTAMP(3),
ADD COLUMN "clientMetadata" JSONB,
ADD COLUMN "missingFields" JSONB;
