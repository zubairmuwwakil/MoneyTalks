ALTER TYPE "WalletEventProcessingStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "WalletEvent"
ADD COLUMN "correctedMerchant" TEXT,
ADD COLUMN "correctedAmount" DECIMAL(15,4),
ADD COLUMN "correctedCurrency" TEXT,
ADD COLUMN "correctedCardId" TEXT,
ADD COLUMN "recoveredAt" TIMESTAMP(3);
