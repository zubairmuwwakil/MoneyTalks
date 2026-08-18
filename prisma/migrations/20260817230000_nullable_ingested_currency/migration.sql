-- Currency on captured observations and their direct projections must remain
-- unknown when the source gives only an ambiguous marker such as bare "$".
-- Existing values are intentionally preserved: historical explicit CAD and
-- previously inferred CAD are indistinguishable without re-reading the source.
ALTER TABLE "EmailTransaction" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "EmailTransaction" ALTER COLUMN "currency" DROP NOT NULL;

ALTER TABLE "Purchase" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Purchase" ALTER COLUMN "currency" DROP NOT NULL;

-- These tables receive currency directly from EmailTransaction/Purchase. They
-- must accept null or persistence would merely move the guess downstream.
ALTER TABLE "PurchaseItem" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "PurchaseItem" ALTER COLUMN "currency" DROP NOT NULL;

ALTER TABLE "AutomationSuggestion" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "AutomationSuggestion" ALTER COLUMN "currency" DROP NOT NULL;

ALTER TABLE "DetectedItem" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "DetectedItem" ALTER COLUMN "currency" DROP NOT NULL;

ALTER TABLE "ReturnItem" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "ReturnItem" ALTER COLUMN "currency" DROP NOT NULL;
