# Import format

`/investments/import` accepts a JSON file with this shape. All amounts are
**integer minor units** (cents). Dates are ISO 8601 (`YYYY-MM-DD`). Currencies:
`CAD`, `USD`, `JMD`. Countries: ISO-3166 alpha-2.

See `e2e/fixtures/import-sample.json` for a complete fictional example.

- `accounts[]` — required. Fields: `type` (RRSP | TFSA | RDSP | FHSA | ROTH_IRA |
  NON_REGISTERED | CASH | CHEQUING | CRYPTO), `name`, `institution`, `country`,
  `currency`, optional `isUSSitus` (boolean), optional `holdings[]`, optional
  `snapshots[]`.
- `holdings[]` — `symbol`, `name`, `domicileCountry`, `quantity` (fractional ok),
  optional `bookCostMinor`, `lastPriceMinor`, `priceAsOf`.
- `snapshots[]` — `balanceMinor`, `asOf`.
- `fxRates[]` — optional. `base`, `quote`, `rate`, `asOf`.

Idempotency: accounts match on `(name, institution)`, holdings on
`(account, symbol)`, snapshots on `(account, asOf)`, FX rates on
`(base, quote, asOf)`. Re-importing updates in place; it never duplicates.

Privacy: this repo never contains real data. Keep your real import file outside
the repo (it is also blocked by `.gitignore` patterns `seed/` and `*.seed.json`).
