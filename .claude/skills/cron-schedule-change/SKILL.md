---
name: cron-schedule-change
description: Use when changing a scheduled job, the QStash schedule config, the price or FX cron, or the MarketLens quote warm-up — including any change to their timing or order.
---

# Changing a scheduled job

Read [`docs/runbooks/quote-cache.md`](../../../docs/runbooks/quote-cache.md) first.
It explains why the warm-up precedes the read, and what a nightly failure looked
like when it did not.

## Rules

- **Warm-up before read, always.** `cron/prices-warmup` (01:45 UTC) forces a
  provider fan-out; `cron/prices` (02:00 UTC) repeats it as a backstop, then reads.
  Do not reorder. Do not reduce the warm-up to a health-endpoint ping.
- **Never target `/api/v1/admin/**`.** That path needs an ADMIN role; this app holds
  a USER key. The answer to the 403 is not an admin key.
- **Assert, do not describe.** Ordering lives in
  `scripts/ops/qstash-schedules.config.test.ts`. Any timing change updates that test
  in the same commit.

## Steps

1. Edit `scripts/ops/qstash-schedules.config.mjs`.
2. Update `scripts/ops/qstash-schedules.config.test.ts` to assert the new ordering.
3. `npx vitest run scripts/ops/qstash-schedules.config.test.ts`
4. `npm run check`
5. Apply with `npm run qstash:schedules`; confirm with `npm run qstash:check`.
