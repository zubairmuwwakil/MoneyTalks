-- CreateEnum
CREATE TYPE "WalletEventProcessingStatus" AS ENUM ('OBSERVED', 'NORMALIZED', 'POSSIBLE_DUPLICATE', 'RECONCILED', 'REVERSED');

-- AlterEnum
ALTER TYPE "PurchaseSource" ADD VALUE 'WALLET';

-- CreateTable
CREATE TABLE "WalletInstallation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WalletInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletInstallationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "shortcutVersion" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantRaw" TEXT,
    "transactionNameRaw" TEXT,
    "amountRaw" DOUBLE PRECISION,
    "currencyRaw" TEXT,
    "cardRaw" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationAccuracyMeters" DOUBLE PRECISION,
    "assumedCurrency" BOOLEAN NOT NULL DEFAULT false,
    "processingStatus" "WalletEventProcessingStatus" NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAlias" (
    "id" TEXT NOT NULL,
    "rawString" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAlias" (
    "id" TEXT NOT NULL,
    "rawString" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerStateRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateData" JSONB NOT NULL,
    "isV1SingleUser" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerStateRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletInstallation_tokenHash_key" ON "WalletInstallation"("tokenHash");

-- CreateIndex
CREATE INDEX "WalletInstallation_userId_idx" ON "WalletInstallation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletEvent_eventId_key" ON "WalletEvent"("eventId");

-- CreateIndex
CREATE INDEX "WalletEvent_userId_eventId_idx" ON "WalletEvent"("userId", "eventId");

-- CreateIndex
CREATE INDEX "WalletEvent_userId_capturedAt_idx" ON "WalletEvent"("userId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAlias_rawString_key" ON "MerchantAlias"("rawString");

-- CreateIndex
CREATE UNIQUE INDEX "CardAlias_rawString_key" ON "CardAlias"("rawString");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerStateRecord_userId_key" ON "OwnerStateRecord"("userId");

-- AddForeignKey
ALTER TABLE "WalletInstallation" ADD CONSTRAINT "WalletInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletEvent" ADD CONSTRAINT "WalletEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletEvent" ADD CONSTRAINT "WalletEvent_walletInstallationId_fkey" FOREIGN KEY ("walletInstallationId") REFERENCES "WalletInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerStateRecord" ADD CONSTRAINT "OwnerStateRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
