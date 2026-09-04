# Community gift-card inventory — production deploy handoff

**Date:** 2026-09-04

## Status

Application and API code are on `main`, Vercel builds successfully, and `npm run check` passes.
The feature remains off by default in PickMe.

The production database migration was applied on 2026-09-04. The target was verified by matching
the linked Vercel `money-talks` production `DATABASE_URL` with `.env.local`'s direct endpoint,
following `docs/runbooks/database-migrations.md`; `npm run db:status` reports the schema up to date.
Do not identify a database from a Neon account display name alone.

## Migration to apply

Canonical migration:

- `prisma/migrations/20260904154500_community_gift_card_inventory/migration.sql`

It creates only `CommunityGiftCardInventoryObservation` and its three indexes. The table has no
`User`, account, email, card, purchase, or device relationship.

## Production command

For any future environment, follow `docs/runbooks/database-migrations.md`. Run this from the
MoneyTalks/In Unity release environment with its verified direct, non-pooled migration URL:

```bash
DIRECT_URL='<IN_UNITY_PRODUCTION_DIRECT_URL>' npm run db:migrate:deploy
```

Do not put the URL in source control or logs.

## Verification

After migration:

1. `npm run db:status` reports the migration applied.
2. POST `/api/community/gift-card-inventory` with a schema-v1 synthetic observation returns 2xx.
3. POST `/api/community/gift-card-inventory/query` for the same exact physical store returns a
   schema-v1 daily aggregate.
4. Confirm the row contains only merchant/store identity, gift-card key, availability, observation
   time, receive time, and observation UUID.
5. Keep PickMe community sharing off by default; local Found it / Not here learning must continue
   when the server is unavailable or the setting is off.

## Safety boundary

The migration target is the endpoint pair configured for the linked In Unity Vercel project, not a
Neon project selected by display name. A production write must pass the canonical runbook's pooled
and direct endpoint verification; never guess or reuse an unrelated database.
