# Financial impact visuals

Status: approved in chat on 2026-08-20.

## Goal

Add one decision-oriented visual workspace to each top-level Purchases, Cards,
and Bills page. The visuals answer whether tracked purchases are rising, which
cards have paid for themselves, and when near-term bill pressure is highest.

## Visual system

- Visual thesis: calm financial instrumentation with one dominant signal,
  restrained colour, and data quality stated beside the number it qualifies.
- Content plan: page header, impact workspace, operational controls, existing
  detailed list.
- Interaction thesis: compact range changes for purchase history, precise
  hover tooltips, and subtle row/bar emphasis that improves scanning.
- Do not add a dashboard-card mosaic, pie charts, ornamental gradients, or
  visuals to forms and single-record pages.

## Purchases

Replace the four-card KPI strip with a `Tracked purchase activity` workspace.
It shows 4-, 12-, and 52-week ranges, weekly gross purchase bars, received
refunds below zero, the selected range versus the immediately preceding
period, and the three merchants contributing most to the selected range.

Every amount is converted to CAD using the latest available user FX rate.
Rows with a missing/unsupported currency or missing FX are excluded from
amounts and counted in a visible data note. Copy says `tracked purchases`, not
`spending`, because capture is not guaranteed to be complete.

## Cards

Replace the portfolio KPI grid with a `Wallet break-even` workspace. Each card
gets a horizontal bullet-style row: recorded rewards plus redeemed credits are
the fill; the owner's effective annual fee is the threshold. The workspace
shows total recorded value, total effective fees, net value, cards at/above
break-even, and renewal context.

Redeemed monthly credits are summed once per redemption period in the current
calendar year. Annual credits count once. Unredeemed catalogue benefits never
count as realized value. The existing manual rewards estimate is treated as
recorded current-year value and labelled as an estimate.

## Bills

Add a `Next 8 weeks` cash-pressure workspace beneath the Bills header and
allocation summary. Weekly bars split fixed obligations from estimated
variable obligations. The workspace reports the total due, average week,
busiest week, and links to the detailed 12-month forecast.

Every occurrence is converted to CAD through the user's FX table. Missing FX
occurrences are excluded and disclosed. The workspace does not show a projected
cash-balance line because current income dates are approximate and would imply
false precision.

## Architecture

Each domain owns a pure, tested view-model builder. Server pages query private
data and pass only serializable aggregates to narrow client chart components.
Recharts remains the only chart library. Formatting, signs, labels, and text
summaries carry meaning in addition to colour.

## Verification

- Unit tests cover period boundaries, comparisons, FX exclusions, refunds,
  realized credit semantics, fee break-even, variable bills, and busiest-week
  selection.
- Existing Vitest, ESLint, and production build checks must pass.
- Browser verification covers all three responsive hub pages when a usable
  local authenticated fixture is available.
