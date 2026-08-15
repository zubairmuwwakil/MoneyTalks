-- CreateTable
CREATE TABLE "Profile" (
    "userId" TEXT NOT NULL,
    "residency" TEXT NOT NULL DEFAULT 'CA',
    "citizenships" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filingStatus" TEXT NOT NULL DEFAULT 'SINGLE_ABROAD',
    "marginalUSRatePct" INTEGER NOT NULL DEFAULT 24,
    "dtcEligible" BOOLEAN NOT NULL DEFAULT false,
    "benefitPrograms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rdspIncomeTier" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "rdspCarryForwardYears" INTEGER NOT NULL DEFAULT 0,
    "rdspGrantsLifetimeMinor" INTEGER NOT NULL DEFAULT 0,
    "rdspContribLifetimeMinor" INTEGER NOT NULL DEFAULT 0,
    "tfsaRoomMinor" INTEGER NOT NULL DEFAULT 0,
    "rrspRoomMinor" INTEGER NOT NULL DEFAULT 0,
    "fhsaRoomMinor" INTEGER NOT NULL DEFAULT 0,
    "nhtContributed" BOOLEAN NOT NULL DEFAULT false,
    "incomeSources" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL DEFAULT '',
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_userId_ruleKey_entityRef_key" ON "Alert"("userId", "ruleKey", "entityRef");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
