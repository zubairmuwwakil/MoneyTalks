-- Preserve category evidence and provenance without rewriting historical rows.
ALTER TABLE "Purchase" ADD COLUMN "rawCategory" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "categoryTaxonomyVersion" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "categoryConfidenceScore" DOUBLE PRECISION;
ALTER TABLE "Purchase" ADD COLUMN "merchantCategoryCode" INTEGER;
ALTER TABLE "Purchase" ADD COLUMN "merchantGroupID" TEXT;

CREATE INDEX "Purchase_userId_rawCategory_idx" ON "Purchase"("userId", "rawCategory");
