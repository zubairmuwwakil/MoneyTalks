CREATE TYPE "EmailFactReprocessJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE');

CREATE TABLE "EmailFactReprocessJob" (
    "userId" TEXT NOT NULL,
    "status" "EmailFactReprocessJobStatus" NOT NULL DEFAULT 'PENDING',
    "targetVersion" TEXT NOT NULL,
    "completedVersion" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockId" TEXT,
    "cursorCreatedAt" TIMESTAMP(3),
    "cursorId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailFactReprocessJob_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "EmailFactReprocessJob_status_runAt_idx"
    ON "EmailFactReprocessJob"("status", "runAt");

ALTER TABLE "EmailFactReprocessJob"
    ADD CONSTRAINT "EmailFactReprocessJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
