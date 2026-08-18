# Ecosystem context (mirrored — canonical copy: `MoneyTalks/ECOSYSTEM.md`)
<!-- ecosystem-sync: v1 2026-08-18 -->

Four sensors describing one person's money. Separate products, shared
infrastructure — **not** one repo, one brand, or one merged app.

*We built separate systems for choosing how to spend, capturing what was spent,
understanding purchases and obligations, and valuing investments — then realized
that connecting them creates a financial operating system that understands a
user's money before, during, and after every transaction.*

| Repo | Product | Owns | Must NOT own |
|---|---|---|---|
| `PickMe` | PickMe (iOS) | ALL card-decision semantics: checkout pick, keep/cancel, benefits, valuation | dashboards / deep analytics UI (A5); market data |
| `return-saas` | Looply (retired) | nothing new — absorbed; live only as a portfolio demo (B1) | any feature work |
| `marketdata` | MarketLens | market data + investment analytics: OHLCV, indicators, corporate actions, calendar, quality | the complete financial picture; purchases; cards |
| `MoneyTalks` | *unifier — consumer name TBD (E1)* | Apple Pay capture, email ingestion, purchase spine, cross-product analytics | card rule semantics (frozen, PickMe owns); market-data ingestion (MarketLens owns) |

Email-derived intelligence was Looply's; it now lives in the hub
(`src/lib/domain/receipts/`, `src/lib/services/email.ts`). The repo is the husk.

MarketLens provides **daily/latest** pricing, not real-time. Say it that way.

## Horizon — read before proposing work

- **v1:** ambient checkout pick · wallet capture · email ingestion ·
  returns/trials/refunds digest · purchase spine · investment tracking via MarketLens (E2)
- **Later:** net worth · cash-flow forecasting · card ROI reporting · tax/cross-border
- **Never on this path:** bank aggregation (no Plaid/Flinks) · paid tiers ·
  event broker · open card editor · return-saas SaaS-shell work

Existing code is NOT authorization: several *later* surfaces already have
engine code with no UI (`src/engine/networth.ts`, `billforecast.ts`,
`taxchecklist.ts`; PickMe's `PortfolioAnalyzer`). Wiring one up is new scope — ask.

## Precedence when docs disagree

`LOG.md` > decision record > this file — **except** this file wins on *identity*
(names, brands, capability ownership, the story).

Conflict outside that: **stop and ask. Do not average them.**

- Canonical decisions: `MoneyTalks/docs/decisions/2026-08-16-one-money-app.md`
- Newest rulings: `MoneyTalks/docs/decisions/LOG.md`
- Long-form narrative (positioning, not a backlog): `MoneyTalks/docs/ECOSYSTEM-NARRATIVE.md`

*This file is mirrored into all four repos. Edit the canonical copy, then run
`scripts/sync-ecosystem.sh` from MoneyTalks. A stamp mismatch means stale.*
