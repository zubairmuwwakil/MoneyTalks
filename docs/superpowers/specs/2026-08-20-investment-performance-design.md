# Investment performance workspace

Status: approved in session 2026-08-20 for implementation. This design adds
cash-flow-adjusted performance tracking from rollout onward. It does not infer
history from current holdings.

## Problem

The investments page reports current account and portfolio values but cannot
answer how much the investments earned. The nightly price cron overwrites each
holding's latest price, so Inunity retains no user-specific daily valuation
history. The small holding sparklines are especially unsafe: they synthesize
four points from book cost and the current price and can be mistaken for real
market history.

MarketLens already owns the correct market-data boundary. It stores daily OHLCV,
corporate actions, adjusted closes, currency, provenance, freshness, calendars,
and quality state. It must not receive user identities, quantities, cash, or
portfolio totals. Inunity owns those personal-finance facts and therefore owns
portfolio performance.

## Goals

- Track honest investment performance from the first complete post-rollout
  valuation.
- Separate external cash flows from investment gain.
- Show portfolio, account, and holding changes over selectable periods.
- Explain the largest contributors and detractors without presenting position
  changes as market gains.
- Make missing, stale, partial, and not-yet-tracked states explicit.
- Improve the page's action hierarchy and replace synthetic history with real
  data.

## Non-goals

- No inferred historical backfill from current quantities.
- No brokerage credential or holdings sync work.
- No benchmark comparison until MarketLens exposes trustworthy total-return
  benchmark series.
- No real-time pricing, forecasts, news, AI commentary, targets, or rebalancing.
- No new portfolio-shaped endpoint in MarketLens.

## Product contract

The page answers four questions in order:

1. What is the portfolio worth?
2. How much did the investments earn after removing deposits and withdrawals?
3. How much money did the user add or remove?
4. Which accounts or holdings drove the change?

The primary measures are:

- **Portfolio value:** the latest complete CAD valuation.
- **Investment gain:** ending value minus starting value minus net external cash
  flow for the selected period.
- **Time-weighted return:** chained daily cash-flow-adjusted returns.
- **Net contributions:** contributions minus withdrawals for the selected
  period.
- **Last-close change:** the cash-flow-adjusted gain and return between the two
  latest complete valuations.

The UI says `Time-weighted return` rather than the ambiguous `Return`. A concise
explanation states that deposits and withdrawals are removed, while dividends,
interest, and fees remain part of performance.

## System boundary

MarketLens remains unchanged for this release. Its existing quote endpoint
continues to supply daily closes with currency, trade date, source, and
freshness. Inunity records the user-specific quantities, account values, cash
flows, FX conversion, and calculated returns.

Raw market price history remains canonical in MarketLens. A price copied into an
Inunity valuation snapshot is an audit input to a user-specific calculation, not
a second market-data source.

## Data model

### `InvestmentAccountSnapshot`

One row per financial account and UTC calendar day:

- `id`
- `accountId` with cascade deletion when the account is deleted
- `asOf` normalized to UTC midnight
- `currency`
- `cashMinor`
- `holdingsMinor`
- `totalMinor`
- `netExternalFlowMinor`
- `displayCurrency` fixed to `CAD` for this release
- `displayTotalMinor`
- `displayExternalFlowMinor`
- `fxRateToDisplay` and `fxAsOf`, nullable only for a CAD account
- `status`: `COMPLETE` or `PARTIAL`
- `holdingCount` and `pricedHoldingCount`
- `earliestPriceAsOf` and `latestPriceAsOf`
- `createdAt` and `updatedAt`

`(accountId, asOf)` is unique so repeated cron or manual refreshes update the
same daily record. Partial rows are retained for diagnostics but are excluded
from return calculations.

`netExternalFlowMinor` is the sum of `CONTRIBUTION` minus `WITHDRAWAL`
transactions since the prior **complete** snapshot through this snapshot's day.
Using the prior complete point prevents a partial day from consuming flows that
the next calculable interval still needs. Transaction create, edit, and delete
paths recompute affected snapshot flow fields so the cached value cannot
silently drift from the canonical ledger.

### `InvestmentPositionSnapshot`

One child row per held symbol in an account snapshot:

- `id`
- `accountSnapshotId`
- `holdingId` as a nullable informational identifier, without a cascading
  relation
- copied `symbol` and `name`, so sold or deleted positions keep their history
- `quantity`
- `priceMinor`, `priceCurrency`, `priceAsOf`, `priceSource`, and `priceStatus`
- `marketValueMinor` in the account currency
- `displayMarketValueMinor` in CAD
- `valuationComplete`

`(accountSnapshotId, symbol)` is unique. Deleting a current holding never
deletes historical position snapshots.

## Daily capture flow

The existing authenticated price cron remains the orchestration point:

1. Select users with financial accounts, including cash-only accounts.
2. Refresh held symbols through MarketLens when the user has holdings.
3. Load current holdings, canonical cash balance, recent transactions, and the
   latest usable FX rows.
4. Compute native-currency account and position valuations with the existing
   fail-closed valuation engine.
5. Convert native values and external flows to CAD using the FX rate recorded
   on the snapshot.
6. Upsert account and position snapshots for the current UTC day in one
   transaction per account.
7. Return aggregate counts for complete, partial, and failed accounts without
   letting one user's error stop the sweep.

Manual price refresh uses the same capture service. Because the snapshot key is
daily, it improves today's record instead of creating intraday pseudo-history.

An account snapshot is complete only when cash can be valued, every held
position has a provable price currency, foreign values have usable FX, and each
holding received a fresh quote in the same refresh run whose trade date matches
MarketLens' `expectedSession`. Persisted `FRESH` labels are never reused as proof
for a later day. A stale last-known price may still be stored for diagnostics,
but the account row is partial and does not become a performance point.
Weekends may produce complete flat points when MarketLens correctly says Friday
is the latest expected equity session; this is not treated as stale.

If refresh or valuation fails, existing prices and snapshots remain unchanged.
There is no zero-fill or fabricated flat day.

## Performance calculation

Performance math lives in a pure domain module independent of Prisma and React.
For two consecutive complete valuations with starting value `V0`, ending value
`V1`, and net external flow `F` during the interval, the daily return uses the
documented end-of-day convention:

```text
r = (V1 - F) / V0 - 1
```

This is the most honest convention available because the current ledger stores
dates, not trustworthy intraday cash-flow times. The UI describes the result as
daily time-weighted return rather than claiming intraday precision.

Period TWR chains daily factors:

```text
TWR = product(1 + r) - 1
```

Period investment gain is:

```text
gain = ending value - starting value - sum(net external flows)
```

`CONTRIBUTION` and `WITHDRAWAL` are external. `BUY` and `SELL` are internal.
`DIVIDEND`, `INTEREST`, and `FEE` remain in performance. A zero or negative
starting value begins a new chain segment instead of dividing by zero. Gaps use
the next pair of complete observations and include all external flows between
them.

Account performance uses native currency. Portfolio performance aggregates the
snapshots' recorded CAD values and CAD flows, so currency movement is part of a
Canadian user's investment experience and historical results do not change when
today's FX rate changes.

## Change attribution

Position snapshots support real sparklines and honest mover explanations.

- When quantity is unchanged across an interval, market contribution is the
  change in CAD market value.
- When quantity changes, the UI labels the row `Position changed` and excludes
  that interval from price-attribution ranking.
- Period attribution sums only eligible intervals and discloses when a position
  had excluded quantity-change days.
- Dividends and fees remain visible in account performance but are not assigned
  to a holding until transactions reliably carry a symbol.

This is deliberately conservative: incomplete attribution is preferable to
calling a purchase a market gain.

## Investments page UX

The page remains a restrained workspace, not a dashboard-card grid.

### Header and actions

- Keep `Add account` as the primary action and `Import` as secondary.
- Move `Market data keys` back to settings.
- Show a `Data health` link only when stale, partial, or missing data needs
  attention.

### Performance workspace

One primary interactive section replaces the current total-value banner:

- Large portfolio value with last-close gain and percentage.
- Selected-period investment gain, TWR, and net contributions.
- `1M`, `3M`, `YTD`, `1Y`, and `All` controls.
- Portfolio/account selector.
- A solid portfolio-value line and a quieter net-contributions line.
- Contribution and withdrawal markers.
- Tooltip values for portfolio value, net invested, investment gain, and daily
  return.
- Desktop layout gives the chart most of the width with a compact `What moved`
  column; mobile stacks them.

The chart is a client component receiving serialized, user-scoped data from the
server page. It provides a text summary and tabular fallback for assistive
technology. Positive and negative states use signs and labels as well as color.

### Account list

Each account row shows:

- Current value.
- Selected-period gain and TWR when tracked.
- A real sparkline from complete account snapshots.
- Cash/holdings composition.
- A clear status such as `Tracking`, `Needs setup`, or `Data incomplete`.

`$0.00` is shown only for a provable zero. An account with no transactions,
snapshot, or holdings says `Needs setup` instead of pretending the value was
measured.

### Tracking and empty states

- No accounts: retain the existing add/import empty state.
- Accounts but no complete performance snapshot: show current values and
  `Performance begins after the next successful daily close.`
- One complete point: show `Tracking since <date>` without a return.
- Partial latest data: keep the last trustworthy headline value, show the gap,
  and link to data health.
- No interpolation is used anywhere.

## Error handling and observability

- Snapshot writes are idempotent and account-scoped transactions.
- One failed account or user does not abort the cron sweep.
- Cron JSON reports users attempted, holdings refreshed, complete snapshots,
  partial snapshots, and failures.
- A sweep with accounts but no complete or partial valuation returns a failing
  status rather than a quiet success.
- Logs contain account/user identifiers only as currently permitted by the cron
  path and never include holdings quantities or values.
- The headline and period calculations use the latest complete snapshot and
  show its as-of date. Before the first complete snapshot exists, the page falls
  back to the existing current-value calculation and labels performance as
  pending.

## Migration and rollout

The schema migration creates empty snapshot tables; it does not backfill them.
The first complete daily capture establishes each account's baseline. The UI
states the exact tracking date.

The synthetic `HoldingSparkline` inputs are removed in the same release. The
component may be replaced by a real snapshot-backed sparkline or deleted if the
new shared performance chart component supersedes it.

Existing financial accounts, holdings, balance snapshots, and transactions are
not rewritten. Existing unrelated working-tree changes are not touched.

## Testing

Implementation follows TDD.

### Pure domain tests

- Positive and negative market returns with no cash flow.
- Contributions and withdrawals removed from gain and TWR.
- Dividends, interest, and fees retained in performance.
- Chained returns across multiple days.
- Missing/partial days and flows spanning a gap.
- Zero starting value and chain restart.
- CAD portfolio aggregation across foreign accounts using recorded FX.
- Position attribution with unchanged and changed quantities.

### Capture and persistence tests

- Complete, partial, cash-only, mixed-currency, and stale valuations.
- Same-day reruns upsert rather than duplicate.
- Failed valuation preserves the last complete snapshot.
- Transaction edits recompute affected flow fields.
- Deleted holdings retain position history.
- One user's failure does not stop later users.

### UI and end-to-end tests

- Baseline-pending, tracking, incomplete-data, and needs-setup states.
- Range and account selection update metrics and chart together.
- Cash-flow markers and mover disclosures render correctly.
- Real zero is distinct from unknown value.
- Keyboard access, accessible chart summary, and non-color status cues.
- Existing add account, holding, transaction, import, and refresh flows continue
  to work.

## Success criteria

- No synthetic investment history remains.
- After two complete daily captures, the page reports cash-flow-adjusted gain
  and TWR for portfolio and accounts.
- Contributions and withdrawals do not appear as investment performance.
- A stale, missing, or partial price cannot silently become a complete point.
- Users can identify the main eligible contributors and detractors for the
  selected period.
- The page remains useful before history exists and after a cron failure.
