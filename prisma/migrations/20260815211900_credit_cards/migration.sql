-- CreateTable
CREATE TABLE "CreditCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "lastFour" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CA',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "limitMinor" INTEGER,
    "statementDay" INTEGER,
    "dueDay" INTEGER,
    "aprPct" DECIMAL(65,30),
    "annualFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "rewards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardState" (
    "cardId" TEXT NOT NULL,
    "capsUsage" JSONB NOT NULL DEFAULT '[]',
    "creditsRedeemed" JSONB NOT NULL DEFAULT '[]',
    "rewardsEstimateMinor" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardState_pkey" PRIMARY KEY ("cardId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditCard_userId_nickname_key" ON "CreditCard"("userId", "nickname");

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardState" ADD CONSTRAINT "CardState_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
