-- Which tier decided Purchase.currency, mirroring the existing categorySource.
--
-- Left NULL on every existing row on purpose. A backfill would have to invent
-- provenance for currencies written before any tier existed, and "we do not
-- know how this was decided" is the honest value for them. New rows get a
-- real tier name from src/lib/domain/receipts/resolveCurrency.ts, including
-- the literal 'none' when the tiers ran and found no evidence — which is a
-- read fact, and distinct from this NULL.
ALTER TABLE "Purchase" ADD COLUMN "currencySource" TEXT;
