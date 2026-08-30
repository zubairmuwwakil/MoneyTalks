-- Persist the algorithm version that produced derived receipt fields. This is
-- deliberately additive: older rows remain readable and future parser changes
-- can replay only the versions that need it.
ALTER TABLE "ReceiptUpload"
ADD COLUMN "extractorVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Purchase"
ADD COLUMN "normalizationVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "EmailTransaction"
ADD COLUMN "parserVersion" INTEGER NOT NULL DEFAULT 1;
