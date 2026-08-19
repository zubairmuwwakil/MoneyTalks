# Project rules (ratified — do not relitigate in-session)

Decision record: docs/decisions/2026-08-16-one-money-app.md · newest rulings: docs/decisions/LOG.md

@ECOSYSTEM.md

- **This repo is the unifier** — the financial command center of a four-product ecosystem. Its **consumer name is TBD** (E1 supersedes D1; PickMe is no longer the consumer brand of the whole product). `MoneyTalks` is a working repo name.
- **Card semantics are owned by PickMe, not here.** The old frozen engine (`src/engine/cards/`) is already DELETED — decision 2's Phase-1 deletion is done. What exists is `src/engine/cards-twin/`, the C1-authorized TypeScript twin: `RuleMatcher`, `CapMath`, `Scorer`, `RecommendationEngine` — **and nothing else**. Swift stays canonical; contract changes land in Swift + fixtures first, and the shared fixture suite gates both languages in CI (`engine-fixtures-ts`, `.github/workflows/ci.yml`). Do not widen the twin beyond C1's scope, and do not add rule-model features, categories, or picker capabilities anywhere in this repo.
- **Market data has one owner and it is not this repo (E3/E4).** Consume MarketLens over HTTP via `src/lib/services/marketlens.ts`; never add a price provider, indicator, or market-data ingestion here. Prices are **daily closes, never real-time** (A6). Investment tracking is in v1 (E2) — net worth, forecasting, and bank aggregation are not. One recorded exception: the crypto CoinGecko path in `src/lib/fetch-prices.ts`, on loan until crypto is ported to MarketLens.
- **Portfolio valuation never hard-depends on a live fetch (E4).** A refresh that learns nothing changes nothing: `refreshHoldingPrices` leaves stored prices untouched on any failure, exactly as the FX cron leaves rates untouched on an empty fetch. Prices are cached in `Holding.lastPriceMinor` and rendered with their real age.
- **A price without a currency must not be summed.** `Holding.priceCurrency` null means "entered by hand before currencies were tracked" and is read as the account's currency *while saying so*; provider-sourced prices are never written without a currency, so null can never silently mean "the provider didn't say". `holdingsValuation()` excludes mismatched-currency holdings from a total and returns them so the UI must disclose them.
- **BYOK keys live here, encrypted, never in MarketLens** (`src/lib/security/providerKeys.ts`, `secretCrypto` envelopes). Decrypted only to ride one outbound header. Never log, echo, or put one in a redirect query string.
- Email/receipt ingestion lives here now (`src/lib/domain/receipts/`, `src/lib/services/email.ts`), absorbed from return-saas. It is the hub's capability, not Looply's.
- Check the decision record before any cross-cutting work.

@AGENTS.md
