-- CreateEnum
CREATE TYPE "RecurringSweepJobStatus" AS ENUM ('PENDING', 'RUNNING');

-- CreateTable
CREATE TABLE "RecurringSweepJob" (
    "userId" TEXT NOT NULL,
    "status" "RecurringSweepJobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockId" TEXT,
    "lastSweptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSweepJob_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "RecurringSweepJob_status_runAt_idx" ON "RecurringSweepJob"("status", "runAt");

-- AddForeignKey
ALTER TABLE "RecurringSweepJob" ADD CONSTRAINT "RecurringSweepJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
