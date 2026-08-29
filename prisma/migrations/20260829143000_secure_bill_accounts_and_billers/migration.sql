-- Full bill-account identifiers are encrypted by the application before they
-- enter accountNumberEncrypted. accountNumber remains temporarily for safe,
-- lazy migration of pre-existing plaintext values.
ALTER TABLE "Bill"
  ADD COLUMN "accountNumberEncrypted" TEXT,
  ADD COLUMN "accountNumberLast4" TEXT,
  ADD COLUMN "accountNumberLabel" TEXT,
  ADD COLUMN "loginIdentifier" TEXT,
  ADD COLUMN "credentialLocation" TEXT,
  ADD COLUMN "serviceUrl" TEXT,
  ADD COLUMN "loginUrl" TEXT,
  ADD COLUMN "billingUrl" TEXT,
  ADD COLUMN "cancellationUrl" TEXT,
  ADD COLUMN "billerKind" TEXT NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "paymentsCanadaCcin" TEXT,
  ADD COLUMN "billerVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "billerVerificationEnv" TEXT;

-- Preserve a safe display suffix for legacy values without copying the full
-- plaintext into any new column. Non-alphanumeric separators are ignored.
UPDATE "Bill"
SET "accountNumberLast4" = RIGHT(REGEXP_REPLACE("accountNumber", '[^[:alnum:]]', '', 'g'), 4)
WHERE "accountNumber" IS NOT NULL AND "accountNumber" <> '';

CREATE INDEX "Bill_sourceAccountId_idx" ON "Bill"("sourceAccountId");
CREATE INDEX "Bill_paymentsCanadaCcin_idx" ON "Bill"("paymentsCanadaCcin");

ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_sourceAccountId_fkey"
  FOREIGN KEY ("sourceAccountId") REFERENCES "FinancialAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
