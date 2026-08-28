# Runbook — the quote cache and its warm-up

**Read when:** changing a cron, the quote path, or price alerting.
**Asserted by:** `scripts/ops/qstash-schedules.config.test.ts`.

## What went wrong, once

MarketLens serves quotes from a cache and only fans out to its upstream provider
on a miss. That fan-out is the expensive, deadline-bound step, and whoever
triggers the first one of the night pays for it. The loser of that race is served
a cached price **indistinguishable from a fresh one** — which is how the price
cron ran one session stale every night for weeks with no error at either end
(`docs/decisions/LOG.md` 2026-08-27).

## The fixed order

1. `cron/prices-warmup` at 01:45 UTC runs `warmQuoteCache`, forcing a provider
   fan-out for our own held symbols via `/api/v1/quotes?...&refresh=true`.
2. `cron/prices` at 02:00 UTC repeats it as a backstop, then reads.

**Do not reschedule the warm-up after the read.** **Do not "simplify" it back to a
health-endpoint ping** — waking the HTTP layer proves nothing about the fan-out.
The ordering is asserted in `scripts/ops/qstash-schedules.config.test.ts`, not just
described here.

**Never point a warm-up at MarketLens' `/api/v1/admin/**` sweep.** That path is
`hasRole("ADMIN")`, this app holds a USER key, and the answer to the 403 is not to
hand the hub an admin key.

## Reading a non-FRESH quote

MarketLens reports *why* a quote is not FRESH: `provider_deadline_exceeded`,
`budget_exhausted`, `session_in_progress`, and others. Carry that cause into alerts
rather than reporting "nothing worked" — never read a "why" you did not ask for,
and never discard the one you did. Keep the vocabulary in sync with MarketLens'
`QuoteService`.
