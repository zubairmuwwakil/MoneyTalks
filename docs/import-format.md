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
  `lastPriceMinor`, `priceAsOf`; optional `bookCostMinor`.
- `snapshots[]` — `balanceMinor`, `asOf`.
- `fxRates[]` — optional. `base`, `quote`, `rate`, `asOf`.
- `bills[]` — optional. `name`, `category` (housing | utilities | subscriptions |
  transport | debt | other); optional `payee`, `currency` (default `CAD`),
  `autopay`, `variable`, `notes`, `prepaymentMonthDay` (`MM-DD`, enables the
  mortgage prepayment reminder), `interestRatePct`. Plus:
  - `cadence` — one of:
    - `{"type": "BIWEEKLY", "anchor": "2026-01-07"}` — every 14 days from the
      anchor. The anchor is any one **known real payment date**; get it wrong and
      every future date and every pileup month is wrong. Biweekly is 26 payments
      a year, not 24.
    - `{"type": "MONTHLY", "dayOfMonth": 1}` — plus optional `startsFrom` and
      `activeMonths` (1–12), which together express instalment plans such as
      "eleven payments, February through December".  A `dayOfMonth` past the end
      of a short month is clamped (31 → Feb 28).
    - `{"type": "QUARTERLY", "anchor": "2026-09-30"}` — every 3 months from the
      anchor, with the same day clamping.
    - `{"type": "ANNUAL", "anchor": "2026-03-15"}` — every 12 months.
  - `schedule[]` — required, at least one entry: `from`, optional `to`,
    `amountMinor`, optional `note`. A bill's amount is a **timeline**: the entry
    whose range contains an occurrence date supplies that occurrence's amount, so
    a rate increase is a new entry rather than an edit. Ranges are inclusive on
    both ends; omit `to` for the open-ended current amount. If two entries
    overlap, the later `from` wins.
- `cards[]` — optional. This section documents the format with invented examples
  only; real card facts belong in a private import file, not the repo. Fields:
  `nickname`, `issuer`, `network` (`VISA` | `MASTERCARD` | `AMEX`), optional
  `lastFour`, `country` (default `CA`), `currency` (default `CAD`),
  `limitMinor`, `statementDay` (1-28), `dueDay` (1-28), `aprPct`, and
  `annualFeeMinor` (default `0`). `rewards` has:
  - `pointValueCents` — cents of value per point; set this from the redemption
    style you actually use in the private import.
  - `fxFeePct` — foreign transaction fee percentage.
  - `baseMultiplier` — fallback earn multiplier.
  - `categoryRates[]` — `{ "category": "groceries", "multiplier": 3 }`, with
    optional `capMinor` and `capWindow` (`MONTH` | `YEAR`) set together.
  - `credits[]` — `{ "id": "fixture-credit", "label": "Fixture credit",
    "valueMinor": 1000, "period": "YEAR" }`.

Idempotency: accounts match on `(user, name, institution)`, holdings on
`(account, symbol)`, snapshots on `(account, asOf)`, FX rates on
`(user, base, quote, asOf)`, bills on `(user, name)`, and cards on
`(user, nickname)`. Account, FX, bill, and card matching are scoped to the
signed-in user. Re-importing updates in place; it never duplicates.

Privacy: this repo never contains real data. Keep your real import file outside
the repo (it is also blocked by `.gitignore` patterns `seed/` and `*.seed.json`).
