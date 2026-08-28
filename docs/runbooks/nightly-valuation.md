# Runbook — the nightly valuation

**Symptom this exists for:** the Investments page shows *Data Incomplete*, the daily
snapshot is `PARTIAL (0/N holdings priced)`, and clicking **Refresh Prices &
Capture** by hand fixes it. If you are doing that every morning, the automation is
broken — read this instead of clicking the button.

Spans two repos. Market data is owned by **MarketLens** (`marketdata`), never by
this one (E3/E4).

## The pipeline

```
01:45 UTC  QStash ──POST──> inunity.ca/api/cron/prices-warmup
                                  │  warmQuoteCache(prisma)
                                  └──GET──> MarketLens /api/v1/quotes?symbols=…&refresh=true
                                                  └──> Yahoo fan-out ──> price_candle cache
                                             (502 + alert if it warms nothing)

02:00 UTC  QStash ──POST──> inunity.ca/api/cron/prices
                                  ├── warmQuoteCache()         ← backstop, non-fatal
                                  ├── refreshHoldingPrices()   ← reads the warm cache
                                  └── captureInvestmentSnapshots()
```

**The order is the design.** MarketLens answers from a cache and only fans out to
Yahoo on a miss. That fan-out is the expensive, deadline-bound step. Whoever
triggers the first one of the night pays for it — and **the loser of that race is
served a cached price indistinguishable from a fresh one**. Put the read first and
you get a silently one-session-stale portfolio with no error at either end. That is
exactly what happened through 2026-08 (`docs/decisions/LOG.md` 2026-08-27).

## Why a snapshot is PARTIAL

`captureInvestmentSnapshots` marks a position `valuationComplete` only when **all**
of these hold:

| Requirement | Fails when |
|---|---|
| price currency known and convertible | no FX rate for the pair |
| holding id in `validatedHoldingIds` | the quote was not FRESH, or `tradeDate < expectedSession` |
| `priceStatus` not `STALE`/`UNAVAILABLE` | MarketLens served a cache fallback |

One incomplete position makes the whole account snapshot `PARTIAL`, and PARTIAL
snapshots are excluded from performance return maths.

## Why a quote was not FRESH — MarketLens' cause vocabulary

Every non-FRESH quote carries `reason`. These are the only values
(`QuoteService.CAUSE_*`); keep this table in sync with that class.

| `reason` | Means | Do |
|---|---|---|
| `provider_deadline_exceeded` | the fan-out ran out of time and was cancelled | raise `MARKETDATA_FANOUT_DEADLINE`; check the host is not cold-starting on every call |
| `provider_error` | the provider threw | check MarketLens logs for `[quotes] ... refresh failed` |
| `budget_exhausted` | daily call budget already spent | raise the provider's `daily-budget` |
| `session_in_progress` | only an unfinished session was on offer | correct — nothing to do; a mid-session bar is not a close |
| `no_provider` | none registered for the asset class | check `MarketDataProviderRegistry` wiring |
| `no_data` | provider asked, returned nothing | usually a bad symbol |
| `null` | the cache was already fresh; no fetch attempted | nothing |

## Diagnosing in order

1. **Did the cron run?** Snapshot `createdAt` should be ~02:00 UTC.
   ```sql
   SELECT "asOf", status, "pricedHoldingCount"||'/'||"holdingCount" AS priced,
          "createdAt", "updatedAt"
   FROM "InvestmentAccountSnapshot" ORDER BY "asOf" DESC LIMIT 14;
   ```
   `createdAt = updatedAt` means the cron was the only writer. **If those rows are
   PARTIAL while the manually-touched ones are COMPLETE, the automation is the
   problem, not the data.** That single comparison is what identified the 2026-08
   outage.
2. **Are the schedules real?** `npx dotenv -e .env.local -- npm run qstash:check`.
   Checks destination, cron, timeout, pause state, and probes each endpoint —
   QStash stores an absolute URL captured at registration and resolves nothing at
   fire time.
3. **Is MarketLens warm and honest?** A cache hit is ~200 ms; a real fan-out is
   seconds. If a fan-out approaches the deadline, that is the warning.
   ```bash
   curl -s -H "X-API-Key: $MARKETLENS_API_KEY" \
     "$MARKETLENS_BASE_URL/api/v1/quotes?symbols=TSLA&assetClass=EQUITY" | jq
   ```
   Compare `tradeDate` with `expectedSession`, and read `reason`.
4. **Force the fan-out yourself and watch the clock.** This is the exact call the
   warm-up makes. If it approaches the deadline warm, it has no chance cold.
   ```bash
   time curl -s -H "X-API-Key: $MARKETLENS_API_KEY" \
     "$MARKETLENS_BASE_URL/api/v1/quotes?symbols=TSLA,XEQT.TO&assetClass=EQUITY&refresh=true" | jq
   ```
   `refresh=true` needs only an ordinary consumer key. The **global** sweep across
   every tracked symbol is a separate, ADMIN-only trigger — it spends shared
   provider budget, so a consumer key gets 403 and should:
   ```bash
   curl -s -X POST -H "X-API-Key: $MARKETLENS_ADMIN_KEY" \
     "$MARKETLENS_BASE_URL/api/v1/admin/quote-sweep" | jq
   ```

## Things that look like fixes and are not

- **Pinging a health endpoint to "warm" MarketLens.** Wakes the HTTP layer, leaves
  the provider fan-out cold. This was the original warm-up and it reported green in
  front of a failure every night.
- **Lowering a fan-out deadline for responsiveness.** It bounds a background
  sweep. Giving up early does not return faster, it returns worse data.
- **Trusting `@Scheduled` on a host that spins down.** A sleeping container fires
  no timers. MarketLens' 22:30 UTC sweep had never run in production.
- **Pointing a consumer at `/api/v1/admin/**`.** That path is `hasRole("ADMIN")`.
  In Unity holds a USER key, so it warms its own symbols with `refresh=true` on
  the ordinary quotes endpoint. Do not "fix" a 403 there by handing this app an
  admin key — that would grant it ingestion and key management to warm a cache.
- **Letting the sweep consult the cache.** The miss test is
  `cachedTradeDate.isBefore(expectedSession)`, so a cache holding a *wrong* candle
  for the *right* date can never repair itself. The sweep force-refreshes.
- **Clicking Refresh Prices & Capture.** It works, which is the trap: it hides the
  broken automation for another day.

## Known residue

TSX holdings written by the retired Alpha Vantage path carry `priceCurrency:
"USD"` and are inflated ~39% by FX conversion. **Live `Holding` rows self-heal on
the next successful refresh** (`planPriceSync` overwrites `priceCurrency` from the
quote). Historical `InvestmentPositionSnapshot` rows do not — repairing those is a
separate, deliberate migration. Inspect with
`node scripts/ops/report-price-currency-drift.mjs`.
