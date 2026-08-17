-- AlterTable
ALTER TABLE "DetectedItem" ADD COLUMN     "sourceEventId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseAttachment" ADD COLUMN     "sourceEventId" TEXT;

-- CreateTable
CREATE TABLE "Waitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedAt" TIMESTAMP(3),

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "cardName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Waitlist_email_key" ON "Waitlist"("email");

-- CreateIndex
CREATE INDEX "CardRequest_userId_idx" ON "CardRequest"("userId");

-- AddForeignKey
ALTER TABLE "CardRequest" ADD CONSTRAINT "CardRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "PurchaseDuplicateDismissal_userId_purchaseLowId_purchaseHighId_" RENAME TO "PurchaseDuplicateDismissal_userId_purchaseLowId_purchaseHig_key";
