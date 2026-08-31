---
name: release-deploy
description: Use when shipping to production, checking how a change reaches users, running a database migration against production, or investigating a deploy.
---

# How a change reaches production

Vercel deploys from GitHub. There is no deploy workflow in `.github/workflows/` —
pushing to `main` is the deploy.

**Migrations do NOT run as part of the build.** `build` is `next build` alone.
Schema changes are a separate, ordered release step — ratified 2026-08-30, see
`docs/decisions/2026-08-30-separate-migrations-from-build.md`. Do not add
`prisma migrate deploy` back into the build command.

```
npm run db:migrate:deploy    # apply the migration first
npm run build                # then deploy the app
```

Pushing to `main` therefore ships code against **whatever schema production
already has**. A pending migration does not announce itself: it surfaces later
as `column X does not exist` from whichever query happens to touch the new
field. That is how `20260830213000_subscription_recurring_obligation_merge` sat
unapplied while the app deployed cleanly — the failure appeared in an unrelated
recurring sweep. Run `npx prisma migrate status` when a change touches the
schema, and again if something reports a missing column.

Migrations use `DIRECT_URL`, because the runtime `DATABASE_URL` is a pooled
connection.

## Before pushing to main

1. `npm run check` — green.
2. If the change touches `prisma/schema.prisma`: confirm a migration exists AND
   is applied — `npx prisma migrate status`, then `npm run db:migrate:deploy`.
   The migration goes out **before** the code that needs it, so keep it
   backward-compatible with the currently deployed app.
3. If it touches a cron, use the `cron-schedule-change` skill.
4. If it touches `contracts/`, use the `contract-sync` skill.

## After

- Sentry is wired in three configs (`sentry.client|edge|server.config.ts`). Check it
  before declaring a deploy healthy.
- The price and FX crons run on QStash, not Vercel Cron. `npm run qstash:check`
  reports what is actually scheduled.

## Secrets

Production env vars live in Vercel, never in the repo. `.env.example` documents every
variable the code reads and `npm run check:env` fails when one is missing — add the
name and a comment there, never a value.
