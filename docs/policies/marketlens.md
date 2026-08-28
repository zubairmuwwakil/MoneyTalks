# Market data (E3, E4, A6)

**Read when:** touching prices, holdings, valuation, or FX.
**Enforced by:** `npm run check:marketdata`, `npm run check:honesty`,
`npm run check:keys`, and tests in `src/engine/holdingsValuation.test.ts`,
`src/lib/domain/investments/priceSync.test.ts` and
`src/lib/domain/investments/refreshHoldingPrices.test.ts`.

MarketLens owns market data. Consume it over HTTP via
`src/lib/services/marketlens.ts`. Never add a price provider, indicator, or
ingestion path here.

- **Daily closes, never real-time** (A6). Say it that way in every surface.
- **A refresh that learns nothing changes nothing** (E4). `refreshHoldingPrices`
  leaves stored prices untouched on any failure, exactly as the FX cron leaves
  rates untouched on an empty fetch. `fetchQuotes` swallows its own transport
  failures and resolves to `null`, so null — not a rejection — is the shape a
  provider deadline arrives in. Prices cache in `Holding.lastPriceMinor` and
  render with their real age.
- **A price without a currency must not be summed.** `Holding.priceCurrency` null
  means "entered by hand before currencies were tracked" and is read as the
  account's currency *while saying so*. Provider prices are never written without
  a currency — `planPriceSync` skips a quote with none, `reason: "no-currency"` —
  so null can never silently mean "the provider didn't say". `holdingsValuation()`
  excludes mismatched-currency holdings from the total and returns them, so the UI
  must disclose them.
- **Validation is `tradeDate >= expectedSession`, never `===`.** Two independently
  deployed services must not have to agree on a calendar date for a valuation to
  count. Exact equality silently recorded whole accounts as PARTIAL.
- **Scope:** investment tracking is v1 (E2). Net worth, forecasting, and bank
  aggregation are not. Engine code existing without a UI is not authorization —
  `src/engine/networth.ts`, `billforecast.ts`, `taxchecklist.ts` are all in that
  state.
- **BYOK keys** live here encrypted (`src/lib/security/providerKeys.ts`,
  `secretCrypto` envelopes), never in MarketLens. Decrypted only long enough to
  ride one outbound header. Never logged, echoed, or placed in a redirect query
  string — a URL lands in browser history, server logs and any referrer at once.
  Enforced by `npm run check:keys`.

## Recorded exception

The CoinGecko crypto path in `src/lib/fetch-prices.ts` is on loan until crypto is
ported to MarketLens (ratified 2026-08-18). It is a dated entry in
`docs/policies/exceptions.json`, reviewed 2026-11-30 — not a permanent carve-out.
