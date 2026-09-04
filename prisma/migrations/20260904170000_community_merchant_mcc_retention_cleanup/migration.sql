-- Scheduled retention deletes select expired rows by this leading column.
CREATE INDEX "CommunityMerchantMCCObservation_observedAt_idx"
ON "CommunityMerchantMCCObservation"("observedAt");
