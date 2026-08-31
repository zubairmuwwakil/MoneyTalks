-- PHASE 6 DRAFT — DO NOT APPLY.
--
-- This file is deliberately outside prisma/migrations. Promote it to a new
-- timestamped migration only in the separately approved retirement change,
-- after every gate in docs/runbooks/subscription-retirement.md is satisfied.
-- A routine `npm run db:migrate:deploy` must not discover this draft.

DO $retirement_gate$
BEGIN
  -- Production had no legacy data at the Phase 4 cutover. Refuse to turn a
  -- later write or environment mismatch into silent data loss.
  IF EXISTS (SELECT 1 FROM "Subscription") THEN
    RAISE EXCEPTION 'Phase 6 blocked: Subscription is not empty';
  END IF;

  IF EXISTS (SELECT 1 FROM "SubscriptionPayment") THEN
    RAISE EXCEPTION 'Phase 6 blocked: SubscriptionPayment is not empty';
  END IF;

  IF EXISTS (SELECT 1 FROM "LegacySubscriptionMapping") THEN
    RAISE EXCEPTION 'Phase 6 blocked: LegacySubscriptionMapping is not empty';
  END IF;

  IF EXISTS (SELECT 1 FROM "DetectedItem" WHERE "subscriptionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Phase 6 blocked: DetectedItem still references Subscription';
  END IF;

  IF EXISTS (SELECT 1 FROM "Notification" WHERE "sourceKind" = 'subscription') THEN
    RAISE EXCEPTION 'Phase 6 blocked: Notification still has a legacy subscription source';
  END IF;

  -- Approved Phase 5 finding: production currently has three live detected
  -- obligations with kind = NULL. Subscription-filtered canonical readers do
  -- not see them, so downstream cutover is not complete until that separately
  -- owned classification problem is resolved.
  IF EXISTS (
    SELECT 1
    FROM "RecurringObligation"
    WHERE kind IS NULL AND "dismissedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Phase 6 blocked: live RecurringObligation rows still have no kind';
  END IF;
END
$retirement_gate$;

ALTER TABLE "DetectedItem"
  DROP CONSTRAINT "DetectedItem_subscriptionId_fkey";
ALTER TABLE "DetectedItem"
  DROP COLUMN "subscriptionId";

DROP TABLE "LegacySubscriptionMapping";
DROP TABLE "SubscriptionPayment";
DROP TABLE "Subscription";

DROP TYPE "LegacySubscriptionMapOutcome";
DROP TYPE "SubscriptionCadence";
DROP TYPE "SubscriptionStatus";
