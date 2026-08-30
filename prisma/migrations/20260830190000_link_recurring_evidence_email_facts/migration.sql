-- Cite the exact persisted email fact so lifecycle payload and provenance stay
-- available through evidence. The column is nullable for purchase evidence and
-- for rows created before the fact lane existed.
ALTER TABLE "RecurringObligationEvidence"
  ADD COLUMN "emailFactId" TEXT;

CREATE UNIQUE INDEX "RecurringObligationEvidence_obligationId_emailFactId_key"
  ON "RecurringObligationEvidence"("obligationId", "emailFactId");

CREATE INDEX "RecurringObligationEvidence_emailFactId_idx"
  ON "RecurringObligationEvidence"("emailFactId");

-- Evidence without its source fact has neither payload nor auditable
-- provenance. Cascade it when the fact is removed instead of retaining a
-- severed citation; obligation deletion already cascades from the other side.
ALTER TABLE "RecurringObligationEvidence"
  ADD CONSTRAINT "RecurringObligationEvidence_emailFactId_fkey"
  FOREIGN KEY ("emailFactId") REFERENCES "EmailObligationFact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
