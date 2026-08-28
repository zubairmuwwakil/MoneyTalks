# Card ownership (C1, D3)

**Read when:** touching cards, the catalogue, `src/engine/cards-twin/`, or `CreditCard`.
**Enforced by:** `npm run check:cards`.

## The line

The catalogue says what the **card** is. `CreditCard` says what the **user's copy**
is — nickname, lastFour, limit, statement/due day, APR, fee dates, `feeRebateMinor`.

Card facts resolve from `contracts/card-catalogue.json` through
`src/lib/cards/catalogueCard.ts`, keyed by `CreditCard.contractCardId`.

`annualFeeMinor` and `feeRebateMinor` live on the per-user row deliberately, and
the check deliberately does not match them: a fee is a term of the owner's
account, and the rebate is their banking package — Scotia's Ultimate Package
rebates up to $150 of the annual fee where Preferred rebates $40, so only the
owner can say which they hold. No figure is ever inferred from the catalogue's
`fee.waiver` prose.

## Why the check exists

This drift has happened twice. First `src/engine/cards/` — a frozen engine,
deleted. Then a larger, later-found twin: `src/lib/cards/presets.ts` +
`CreditCard.rewards` + `CardRewards` + a 1,460-line rewards editor, which were a
second hand-authored rate model for the same 27 cards. Prose caught neither. See
`docs/decisions/LOG.md` 2026-08-19.

If you find yourself adding a rate, cap, multiplier or credit to a per-user row,
stop — that is the drift this rule exists to prevent.

## What exists here

`src/engine/cards-twin/` — the C1-authorized TypeScript twin: `RuleMatcher`,
`CapMath`, `Scorer`, `RecommendationEngine`, **and nothing else**. Do not widen it
beyond C1's scope, and do not add rule-model features, categories, or picker
capabilities anywhere in this repo.

Swift stays canonical. Contract changes land in Swift + fixtures first; the shared
fixture suite gates both languages in CI (`engine-fixtures-ts`,
`.github/workflows/ci.yml`). A card not in the catalogue goes through
`/cards/request` (D3), never a hand-authored rate.

## Syncing contracts

The short version: commit in PickMe first, then `./scripts/sync/sync-contracts.sh`.
The script refuses a dirty PickMe tree, because a manifest recording "PickMe at
`<sha>` had `<bytes>`" for a pairing that never existed is worse than no manifest —
that happened on 2026-08-24.
