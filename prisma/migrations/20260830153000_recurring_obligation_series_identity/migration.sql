-- One merchant/currency bucket may contain multiple real recurring series.
-- Keep the email-derived discriminator separate from an opaque series key so
-- two monthly plans can coexist and a changing cadence does not change row
-- identity.
ALTER TABLE "RecurringObligation"
ADD COLUMN "seriesKey" TEXT NOT NULL DEFAULT '';

-- Preserve every existing row. Detector-owned rows are anchored to their
-- earliest linked occurrence, which is also the deterministic seed used for a
-- newly discovered series. A row without purchase evidence receives a stable
-- row-local fallback and can later be reconciled by whatever evidence exists.
UPDATE "RecurringObligation" AS obligation
SET "seriesKey" = COALESCE(
    'purchase:' || (
        SELECT evidence."purchaseId"
        FROM "RecurringObligationEvidence" AS evidence
        WHERE evidence."obligationId" = obligation.id
          AND evidence."purchaseId" IS NOT NULL
        ORDER BY evidence."occurredAt" ASC, evidence."purchaseId" ASC
        LIMIT 1
    ),
    'row:' || obligation.id
)
WHERE obligation.origin <> 'USER';

DROP INDEX "RecurringObligation_identity_with_currency_key";
DROP INDEX "RecurringObligation_identity_without_currency_key";

CREATE UNIQUE INDEX "RecurringObligation_identity_with_currency_key"
ON "RecurringObligation"("userId", "merchantCanonicalId", "currency", "discriminator", "seriesKey")
WHERE "currency" IS NOT NULL;

CREATE UNIQUE INDEX "RecurringObligation_identity_without_currency_key"
ON "RecurringObligation"("userId", "merchantCanonicalId", "discriminator", "seriesKey")
WHERE "currency" IS NULL;
