# Community gift-card inventory — production deploy handoff

**Date:** 2026-09-04

## Status

Application and API code are on `main`, Vercel builds successfully, and `npm run check` passes.
The feature remains off by default in PickMe.

The production database migration is intentionally **not applied from this work session** because
the connected Neon account exposes only `pickleopsdb` and `llm4life`; neither is the In Unity
production database. Do not guess or reuse either project.

## Migration to apply

Canonical migration:

- `prisma/migrations/20260904154500_community_gift_card_inventory/migration.sql`

It creates only `CommunityGiftCardInventoryObservation` and its three indexes. The table has no
`User`, account, email, card, purchase, or device relationship.

## Production command

Run this from the MoneyTalks/In Unity deployment environment after resolving the real production
Neon database and setting its direct, non-pooled migration URL:

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

The connected Neon projects named `pickleopsdb` and `llm4life` are explicitly **not** acceptable
migration targets for this feature. A production write must wait for the actual In Unity database
connection or the Vercel deployment environment that owns `DIRECT_URL`.
