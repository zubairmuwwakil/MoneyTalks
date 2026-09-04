# In Unity — agent router

`MoneyTalks`: financial command center. Product: **In Unity** (`inunity.ca`).

**This repo must not own** card rates (PickMe owns them, C1/D3) or market-data
ingestion (MarketLens owns it, E3/E4). It owns email/receipt ingestion, absorbed
from Looply. `npm run check` enforces all three.

## One command

```
npm run check
```

Lint, typecheck, env, guardrails and the unit suite — well under a minute. **It is
the checklist.** There is no other checklist. Also: `npm run dev`, `npm run e2e`
(needs Postgres + Clerk dev keys), `npx prisma migrate dev`.

### Database migrations

`npm run build` never migrates. For local and production migration commands,
target verification, Vercel's pooled URL, and post-deploy checks, follow
[`database-migrations.md`](docs/runbooks/database-migrations.md). Agents are
pre-authorized to deploy pending migrations when its checks pass. Never migrate
inside an application build.

## Read when you are…

| File | …doing this |
|---|---|
| [`REPO_MAP.md`](REPO_MAP.md) | creating any file under `docs/` or `scripts/` |
| [`community-merchant-mcc.md`](docs/decisions/2026-09-04-community-merchant-mcc.md) | changing community MCC endpoints, anonymous MCC storage/aggregation, privacy/retention, abuse controls, telemetry, or scaling |
| [`card-ownership.md`](docs/policies/card-ownership.md) | touching cards, the catalogue, or the twin |
| [`marketlens.md`](docs/policies/marketlens.md) | touching prices, holdings, valuation, or FX |
| [`quote-cache.md`](docs/runbooks/quote-cache.md) | changing a cron or the quote path |
| [`database-migrations.md`](docs/runbooks/database-migrations.md) | creating, checking, or applying a database migration |
| [`exceptions.json`](docs/policies/exceptions.json) | a check is wrong for your task — add a dated entry and keep moving |
| [`LOG.md`](docs/decisions/LOG.md) · [record](docs/decisions/2026-08-16-one-money-app.md) | cross-cutting work — both are ratified, not open |
| [`ECOSYSTEM.md`](ECOSYSTEM.md) | anything spanning repos, or scoping v1 vs later |
| [`FLEET.md`](FLEET.md) | choosing a model and effort |

## Freedom

Anything not named here and not caught by `npm run check` is yours to decide.
Prefer acting and letting the check fail over asking.
Work directly on `main`; do not open branches or PRs (`LOG.md` 2026-08-30).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
