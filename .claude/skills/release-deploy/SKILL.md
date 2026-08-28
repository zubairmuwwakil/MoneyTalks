---
name: release-deploy
description: Use when shipping to production, checking how a change reaches users, running a database migration against production, or investigating a deploy.
---

# How a change reaches production

Vercel deploys from GitHub. There is no deploy workflow in `.github/workflows/` —
pushing to `main` is the deploy.

`package.json`'s `build` is `prisma migrate deploy && next build`, so **migrations
run as part of the build**. A migration that fails fails the deploy; it does not
half-apply and continue.

## Before pushing to main

1. `npm run check` — green.
2. If the change touches `prisma/schema.prisma`, confirm a migration exists:
   `npx prisma migrate status`.
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
