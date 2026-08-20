# Card identity collapse — one card model across Inunity and PickMe

Status: ratified in session 2026-08-19. Supersedes nothing in the decision
record except the scope note recorded in `LOG.md` for this date.

## Problem

The hub carries **two complete, non-overlapping card engines** for the same
27 Canadian cards.

| | Data | Model | Consumers |
|---|---|---|---|
| Path 1 | `src/lib/cards/presets.ts` (1,458 lines, hand-written) → `CreditCard.rewards` | `CardRewards` | `/cards`, `/cards/[id]`, `/cards/manage`, `card-form`, `fees.ts`, `/api/cron/notify`, `/api/events` |
| Path 2 | `contracts/card-catalogue.json` (PickMe-owned, fixture-gated) | `src/engine/cards-twin` | `/bills`, `/api/v1/wallet-events`, `cap-usage`, `ownerState` |

They share **no consumers**. The subsystem behind Path 1 is 3,741 lines.

Three things make Path 1 the one to delete:

1. **It is the weaker model.** The catalogue expresses MCC include/exclude,
   country/currency/channel predicates, `accountYear` caps with anchor and
   reset timezone, `postCapEarn`, FX free-allowance with post-allowance rate,
   effective-dated `announced` rules, and proration. `CardRewards` projects
   all of that onto a fixed 11-category enum.
2. **It has no provenance.** Every catalogue rule carries `sourceType:
   issuerConfirmed`, `lastVerifiedAt`, and an issuer source URL. A preset
   carries a `highlights: [...]` array of marketing strings.
3. **It is owned by the wrong repo.** `ECOSYSTEM.md`: PickMe owns ALL
   card-decision semantics; the hub must not own card rule semantics. That is
   an *identity* claim, so `ECOSYSTEM.md` wins on it outright.

Two ratified rules were already being violated:

- Decision 2 (card semantics are PickMe's). It fired against
  `src/engine/cards/` and authorized the narrow twin. `presets.ts` is the
  larger duplicate, in a different directory, and was never in scope.
- **D3: "No open card editor (quality moat)."** `src/components/card-form.tsx`
  is 1,460 lines letting any user author `categoryRates`, `capGroups`,
  `conditions`, `merchantRates`, and `baseRateOverrides` for any card.

The ids had drifted too: 27 presets, 27 catalogue cards, exactly the same
cards by `officialName` — but **only 10 of 27 ids agreed** (`td-aeroplan-vi`
vs `td-aeroplan-visa-infinite`, `crypto-indigo` vs `cryptocom-royal-indigo`,
and 15 more).

## Target architecture

One card fact lives in exactly one place, keyed by the catalogue `cardId`.

| Layer | Owner | Holds | Example |
|---|---|---|---|
| **Catalogue** | PickMe (Swift canonical) | What the card *is* | earn rules, caps, FX, credits, fee waivers, benefits |
| **`CreditCard`** | Inunity | What *your instance* is | nickname, lastFour, limit, statement/due day, APR, fee dates, `contractCardId` |
| **`OwnerState.cardStates`** | synced both ways | Your *answers* | `feeWaiverActive`, `selectedCategories`, `rogersEligibleServiceLinked` |
| **`CardState`** / `CapUsageLedger` | Inunity | Your *activity* | credits redeemed, observed cap spend |

`contractCardId` is the join. It already exists on `CreditCard` and is already
the identity Wallet-capture aliases resolve against — this design finally
populates it everywhere and makes it load-bearing.

## Phases

**A — Identity (hub only).**
Rename the 17 divergent `CARD_PRESETS` ids to their catalogue `cardId`
(safe: `preset.id` is a React key, never persisted, never on a wire). Add
`contractCardId` as a **required** field on `CardPreset` so TypeScript
refuses a future preset that isn't catalogue-linked. Persist it from
`createCard`/`updateCard`. Add a CI test asserting a bijection between
presets and catalogue cards — this is the anti-drift ratchet, the same role
`engine-fixtures-ts` plays for the twin.

**B — Catalogue absorbs credits and fee waivers (PickMe first).**
The catalogue has no concept of statement credits (Platinum's $200 travel /
$200 dining) or structured fee waivers (Scotia Ultimate, TD All-Inclusive);
`benefits-catalogue.json` is insurance only — 4 families, 10 kinds, verified.
Those move out of `presets.ts` and into the card catalogue, landing in
**Swift + schema + fixtures first** per CLAUDE.md, then mirrored into
`src/engine/cards-twin/models.ts`.

Safety property: the 27 golden fixtures assert checkout *pick* and earn value
only. Credits and waivers are not read by `RecommendationEngine`, so this
phase is additive and cannot perturb them.

**C — Rewire and delete (hub only).**
Point all seven Path-1 consumers at the catalogue. Delete `presets.ts`,
`CardRewards`, the rewards half of `card-form.tsx`, `card-preset-selector`,
and the rewards half of `card-preview`. `/cards/new` becomes: pick your card
from the catalogue, then fill in facts about *your* copy. Cards not in the
catalogue route to the existing `CardRequest` flow (`/api/card-requests`),
which is D3's stated expansion path and is already built.

**D — Two-way sync (both repos).**
`GET /api/spine/owner-state` (currently PUT-only). `PUT` becomes a merge, not
a blind replace: `ownedCardIds` union — never remove, because an absence is
never proof of non-ownership — `cardStates` merged per card, and
`switchThreshold`/`valuationsCad`/`defaultCardId` last-writer-wins with the
default forced to stay inside the union. Concurrency reuses the optimistic
`updateMany`-guarded-on-`updatedAt` pattern already proven in
`reconcileOwnedCards`. PickMe gains `fetchOwnerState()` and seeds its wallet
picker on first run when signed in — seed only, never overwriting a
non-empty local wallet.

Fee schedule (`annualFeeMinor`, `feeMonthDay`, `feeCancelGraceDays`) syncs to
PickMe because keep/cancel is PickMe's ratified domain. Credit limit, APR and
statement day do **not** — they serve utilization and payment timing, which
are hub concerns PickMe has no use for.

## Migration

`CreditCard.rewards` is dropped. Existing rows keep their card; what they
lose is a hand-authored rate model that was never issuer-sourced. Rows whose
`contractCardId` is null are surfaced for one-tap linking against the
catalogue rather than silently rescored — a wrong auto-match is worse than an
honest prompt, the same posture `holdingsValuation()` takes for a
mismatched-currency holding.

## Testing

TDD throughout. Baseline before this work: 85 files / 793 tests green. The
bijection test in phase A and the unchanged 27 golden fixtures in phase B are
the two ratchets that keep the collapse from silently regressing.
