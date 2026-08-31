# In Unity — agent router

The financial command center of a four-product ecosystem. `MoneyTalks` is its
repo name; the product is **In Unity** (`inunity.ca`).

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

### Build and database migrations

`npm run build` builds the application only; it deliberately does **not** run
database migrations. Before a production deploy, run
`npm run db:migrate:deploy` as a separate release step with `DIRECT_URL` pointed
at the direct Postgres endpoint, then run `npm run build`. Never put migrations
back into the build command or let multiple application instances race them.
For local schema development, use `npx prisma migrate dev`.

Agents are pre-authorized to run `npm run db:migrate:deploy` whenever a requested
production change has pending migrations. Verify `DIRECT_URL` is configured for
the direct production endpoint, then run it without waiting for separate approval.

## Read when you are…

| File | …doing this |
|---|---|
| [`REPO_MAP.md`](REPO_MAP.md) | creating any file under `docs/` or `scripts/` |
| [`card-ownership.md`](docs/policies/card-ownership.md) | touching cards, the catalogue, or the twin |
| [`marketlens.md`](docs/policies/marketlens.md) | touching prices, holdings, valuation, or FX |
| [`quote-cache.md`](docs/runbooks/quote-cache.md) | changing a cron or the quote path |
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
