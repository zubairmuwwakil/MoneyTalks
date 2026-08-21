# Dashboard Net-Worth History Design

## Goal

Turn the dashboard's net-worth line into trustworthy daily wealth history without duplicating the Investments performance workspace.

## Product boundary

- The dashboard answers: “How has my total wealth changed?”
- The Investments page answers: “How did my investments perform after removing deposits and withdrawals?”
- Net-worth change therefore includes deposits, withdrawals, market movement, and currency movement.
- The dashboard uses complete nightly account valuations and never presents a partial portfolio total as complete.
- History begins when complete nightly valuations exist. Legacy cash-only balance snapshots are not blended into total-account history because that would understate historical holdings.

## Visual direction

- **Visual thesis:** a calm financial ledger with one dominant wealth number and a quiet, precise history line.
- **Content plan:** current net worth in the existing header; selected-period change and freshness immediately above the chart; chart and exact-value tooltip; compact tracking or incomplete-data status below it.
- **Interaction thesis:** instant range switching with a restrained pressed-state transition, a short chart redraw, and hover detail for exact daily totals.

## Experience

- Default to one month and offer 1W, 1M, 3M, YTD, 1Y, and All.
- Show the absolute and percentage change between the first and last complete points in the selected period.
- Show “through <date>” so a user can distinguish the live headline from the latest nightly close.
- If fewer than two complete portfolio observations exist, explain that tracking has started instead of showing a fake zero change.
- If an account's expected daily valuation is missing or partial, retain the last complete chart value, name the affected accounts, and label the history incomplete.
- Pending history and data health are independent: name incomplete accounts even before two complete portfolio observations exist.
- Range changes must be accessible as buttons with `aria-pressed`; the chart must have a concise screen-reader summary.

## Data architecture

- Query `InvestmentAccountSnapshot` rows with each financial account on the dashboard.
- Use complete snapshots only.
- Prefer the snapshot's stored display total when its display currency matches the dashboard currency.
- Otherwise prefer the native total when the account currency matches.
- Otherwise convert with the latest FX rate at or before the snapshot capture timestamp; never use evidence published later that day.
- Aggregate only dates on which every account that had begun tracking has a complete convertible observation. Do not forward-fill missing expected account valuations.
- Preserve historical nightly valuations even if an account's current holdings, transactions, or legacy cash snapshots are later removed.
- A missing range boundary may use a preceding nightly baseline no more than three calendar days old; older observations are never labelled as the selected period's baseline.
- Keep the current live net-worth headline calculation unchanged.

## Non-goals

- No investment return, gain attribution, movers, holdings comparison, or contribution markers on the dashboard.
- No historical-price backfill.
- No database migration or new cron job.
