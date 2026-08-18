# Project rules (ratified — do not relitigate in-session)

Decision record: docs/decisions/2026-08-16-one-money-app.md · newest rulings: docs/decisions/LOG.md

@ECOSYSTEM.md

- **This repo is the unifier** — the financial command center of a four-product ecosystem. Its **consumer name is TBD** (E1 supersedes D1; PickMe is no longer the consumer brand of the whole product). `MoneyTalks` is a working repo name.
- **Card semantics are owned by PickMe, not here.** The old frozen engine (`src/engine/cards/`) is already DELETED — decision 2's Phase-1 deletion is done. What exists is `src/engine/cards-twin/`, the C1-authorized TypeScript twin: `RuleMatcher`, `CapMath`, `Scorer`, `RecommendationEngine` — **and nothing else**. Swift stays canonical; contract changes land in Swift + fixtures first, and the shared fixture suite gates both languages in CI (`engine-fixtures-ts`, `.github/workflows/ci.yml`). Do not widen the twin beyond C1's scope, and do not add rule-model features, categories, or picker capabilities anywhere in this repo.
- **Market data has one owner and it is not this repo (E3/E4).** Consume MarketLens (`../marketdata`); never add a price provider, indicator, or market-data ingestion here. Investment tracking is in v1 (E2) — net worth, forecasting, and bank aggregation are not.
- Email/receipt ingestion lives here now (`src/lib/domain/receipts/`, `src/lib/services/email.ts`), absorbed from return-saas. It is the hub's capability, not Looply's.
- Check the decision record before any cross-cutting work.

@AGENTS.md
