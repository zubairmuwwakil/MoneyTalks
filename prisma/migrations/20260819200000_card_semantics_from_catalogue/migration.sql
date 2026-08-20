-- Card rate semantics move to PickMe's catalogue, keyed by CreditCard.contractCardId.
--
-- "rewards" held a hand-authored per-user copy of rules the catalogue already
-- states with issuer provenance. It is dropped rather than migrated: there is
-- nothing in it the catalogue does not express better, and keeping it would
-- leave two rate models in the tree — the drift this change exists to end.
-- See docs/superpowers/specs/2026-08-19-card-identity-collapse-design.md.
--
-- "feeRebateMinor" is the one genuinely per-user fact the old model carried
-- inside "rewards.conditions": how much of the annual fee the owner's banking
-- package actually rebates. It is backfilled below from the enabled conditions
-- so no user loses a rebate they had already recorded.

ALTER TABLE "CreditCard" ADD COLUMN "feeRebateMinor" INTEGER NOT NULL DEFAULT 0;

-- Backfill: sum annualFeeReductionMinor across conditions the owner had ticked.
-- Guarded on jsonb_typeof so a row with a malformed or absent rewards blob is
-- skipped rather than aborting the migration.
UPDATE "CreditCard" c
SET "feeRebateMinor" = COALESCE(sub.total, 0)
FROM (
  SELECT
    cc.id,
    SUM(COALESCE((cond ->> 'annualFeeReductionMinor')::int, 0)) AS total
  FROM "CreditCard" cc
  CROSS JOIN LATERAL jsonb_array_elements(cc."rewards" -> 'conditions') AS cond
  WHERE jsonb_typeof(cc."rewards" -> 'conditions') = 'array'
    AND (cond ->> 'enabled')::boolean IS TRUE
  GROUP BY cc.id
) AS sub
WHERE c.id = sub.id;

ALTER TABLE "CreditCard" DROP COLUMN "rewards";
