CREATE TABLE "WalletCaptureDiagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletEventId" TEXT,
    "clientReportId" TEXT NOT NULL,
    "includedTransactionDetails" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WalletCaptureDiagnostic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WalletCaptureDiagnostic_clientReportId_key" ON "WalletCaptureDiagnostic"("clientReportId");
CREATE INDEX "WalletCaptureDiagnostic_userId_submittedAt_idx" ON "WalletCaptureDiagnostic"("userId", "submittedAt");
CREATE INDEX "WalletCaptureDiagnostic_expiresAt_idx" ON "WalletCaptureDiagnostic"("expiresAt");
ALTER TABLE "WalletCaptureDiagnostic" ADD CONSTRAINT "WalletCaptureDiagnostic_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletCaptureDiagnostic" ADD CONSTRAINT "WalletCaptureDiagnostic_walletEventId_fkey"
  FOREIGN KEY ("walletEventId") REFERENCES "WalletEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
