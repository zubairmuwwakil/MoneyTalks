# Geo category tier: resolving a purchase's category from where it happened

Status: design ratified in chat 2026-08-30. Not yet implemented.

Adds two tiers to `resolveCategory`'s provenance ladder that read a signal the
hub has captured and stored since the native wallet work but has never once
looked at: `WalletEvent.latitude/longitude`. A phone that captured a tap knows
which shops stand at those coordinates; Apple knows what trade each shop is in.
Joining the payment descriptor to that place list categorizes purchases whose
descriptor no table recognizes.

## 1. Decisions ratified

| Question | Ruling |
|---|---|
| Who performs the lookup | **The device.** Upholds LOG 2026-08-26; no server-side Apple credential, no external dependency on the ingest path. |
| What crosses the wire | **Raw Apple POI evidence**, never a decided category. The POI→token table is vendored from Swift as a contract. |
| Who runs the match rule | **The server.** The device sends the candidate set; In Unity decides identity, meaning, and confidence. |
| Match rule | **Two tiers, fail closed.** Name agreement writes; a lone nearby POI only suggests; ambiguity resolves nothing. |
| Authority | `geoConfirmed` = **high** (writes). `geoNearby` = **low** (✨ pill only). |
| Propagation | **The purchase row only.** Nothing geo-derived writes `MerchantAlias`. |
| Evidence retained | **The full observation**; the category mapping is derived at read, never stored as the source of truth. |
| Lookup timing | **In the outbox drain, before upload.** The receipt path and its 2s location budget are untouched. |
| Failure record | **A `WalletPlaceOutcome` per event**, mirroring `WalletLocationOutcome`. |
| Coordinate retention | **Unchanged.** The privacy policy's *justification* is corrected; the retention ruling stays its own decision. |
| Contract changes | **Re-runnable** over history via `scripts/ops/reresolveGeoCategories.ts`, wired into the `contract-sync` skill. |

## 2. Why this signal, and why it was left alone until now

LOG 2026-08-26 built the categorization ladder and explicitly listed geo as a
signal it was declining to use: *"Geo is still unused — a server-side reverse
geocode is an external dependency, and the honest owner of that lookup is the
device."* That sentence is the reason this design puts the lookup on the phone.
It is not a hedge against Apple's API; it is a statement about which component
is in a position to observe the fact.

Three things make the signal worth taking now:

- **The coordinates are already captured, stored, and unread.** Native capture
  has written `latitude`, `longitude`, `locationAccuracyMeters` and
  `locationCapturedAt` on every located `WalletEvent` since 2026-08-23. No new
  collection is proposed here.
- **The published privacy policy already describes this feature.** `src/app/privacy/content.ts`
  tells owners that location "is what lets the server tell a coffee shop from a
  gas station when the transaction text is unreadable." That claim is currently
  false — nothing reads the coordinates. See §9.
- **PickMe has already built and shipped the hard half.** `LiveMerchantProvider.nearby`
  does the POI fetch; `CategoryMapper.predict(poiCategoryRaw:merchantName:)`
  maps a POI category to a catalogue token. This design consumes that work
  rather than reimplementing it.

### Why the descriptor and the place are stronger together

The hub's problem is a *string*; PickMe's is a *place*. Neither alone is
reliable: a descriptor like `SQ *CAFE METRO` names a merchant no table holds,
and a coordinate in a mall names twenty. The join is what is strong — when the
folded descriptor agrees with exactly one nearby shop's name, two independent
signals have corroborated each other, and the POI category of that shop is then
Apple's editorial fact about a place we have positively identified.

## 3. Scope, stated honestly

Only a purchase carrying wallet-captured coordinates is reachable. `GMAIL`,
`UPLOAD`, and `MANUAL` rows have no location and never will, so the
uncategorized backlog visible on `/purchases` will move by less than its size
suggests. `scripts/ops/probeCategoryBacklog.ts` measures the real ceiling —
uncategorized purchases holding a located wallet capture — and its output sets
the expectations recorded here and the thresholds in §6.

This is not an argument against the tier. Wallet taps are the highest-frequency,
lowest-metadata purchases in the corpus: they arrive with no receipt, no sender
domain, and no line items, so they are precisely the rows the existing ladder
serves worst, and they compound as capture adoption grows.

## 4. Architecture

```
PickMe (device)                      In Unity (server)
───────────────                      ─────────────────
tap → App Intent
  └ 2s location fix ─────────────┐   (unchanged)
  └ persist to outbox            │
                                 │
outbox drain (network already    │
required)                        │
  └ MKLocalPointsOfInterest      │
      (stored coords, r=200m)    │
  └ ≤8 candidates, no coords ────┼──▶ POST /api/v1/wallet-events
                                 │      └ parseWalletCapturePayload
                                 │      └ matchPlace()      ← pure, sync
                                 │      └ resolveCategory() ← pure, sync
                                 │      └ Purchase.category + categorySource
```

The load-bearing property: **no network call is added to any hot path in either
repo.** PickMe's lookup rides a drain that already required network. In Unity's
tiers are pure functions over data handed to them — `resolveCategory` keeps the
purity its doc comment promises, despite the feature being a network geocode.

### The device/server line

The device reports **what is physically near these coordinates** — a sensor fact
only it can observe. The server decides **which one you paid, and what that
means** — a semantic judgment it can revise later. This is the same line LOG
2026-08-23 drew for native capture ("raw Apple values and server-side semantic
normalization remain").

The match rule lives on the server specifically so it stays tunable. A rule on
the device can only change with an App Store release and can never re-adjudicate
past captures; a rule on the server changes in a deploy and re-runs over all of
history (§10).

## 5. The wire

`schemaVersion` stays **2**. `captureVersion` bumps. The `place` object is
optional and additive, so every PickMe build already in the field keeps
uploading unchanged and `schema1Envelope` is untouched.

```jsonc
"place": {
  "outcome": "resolved",           // see WalletPlaceOutcome below
  "candidates": [                  // ≤ 8, nearest first; omitted unless resolved
    { "name": "Cafe Metro", "poiCategoryRaw": "MKPOICategoryCafe", "distanceMeters": 18.4 }
  ]
}
```

Candidates carry **no coordinates**. Their name, trade, and distance are what
the match rule needs; a second set of coordinates would add a privacy surface
and buy nothing.

### `WalletPlaceOutcome`

Device-side outcomes describe **fetching only**:

`resolved` · `noCandidates` · `lookupFailed` · `locationUnavailable`

`matched`, `ambiguous`, `noAgreement`, and `accuracyTooLow` are **server
verdicts** and are never claimed by the device. The accuracy gate in particular
is deliberately *not* applied on the phone: the device would otherwise suppress a
lookup whose candidates a later, retuned threshold would have accepted, and §4's
whole point is that thresholds move server-side without an app release. Recording the outcome rather than a bare null is what
makes "why is geo not firing?" answerable from data: `ambiguous` says tune the
rule, `noCandidates` says the rule is fine and the shops are not there.

## 6. The match rule

`src/lib/domain/merchants/matchPlace.ts` — **pure and synchronous**, every rule a
unit test, matching the house style of `normalizeMerchant.ts`.

Input: the `NormalizedMerchant`, the candidate list, and `locationAccuracyMeters`.
Output: the selected place and the tier it earned, or nothing.

| Tier | Requires | Confidence | Effect |
|---|---|---|---|
| `geoConfirmed` | The folded descriptor agrees with **exactly one** candidate's folded name, and accuracy ≤ 100 m | `high` | Written by `shouldAutoApply` |
| `geoNearby` | **No** name agreement, but **exactly one** candidate within 50 m, and accuracy ≤ 30 m | `low` | ✨ pill only |
| — | Zero candidates, ties at either tier, or accuracy gate failed | `none` | Resolves nothing |

A **null `locationAccuracyMeters` fails both gates.** An unreported accuracy is
an unknown one, and the whole rule is written to fail closed; treating "we were
not told" as "good enough" is how a loose fix would slip past the tier that has
nothing but proximity to stand on.

Name agreement reuses `foldMerchantText` on both sides, comparing against
`normalized.fullKey` first and then `normalized.brandKey` — the same
un-stripped-first order `findPackMerchantByBrandKey` uses, and for the same
reason (`UBER *EATS` must not become "eats").

### Why fail closed

Ported from `CaptureMatcher`, which solves a structurally identical join and
states the asymmetry plainly: *"A missed match costs the owner one manual entry
they were doing anyway; a wrong match writes a fabricated charge into the log."*
Here a missed category costs one tap; a wrong category silently mis-scores cap
accrual for a purchase the owner never reviewed.

The mall case is handled by the rule itself rather than by a heuristic: a food
court yields many candidates, so both tiers decline.

### Why these thresholds

The fetch radius is 200 m, reusing PickMe's existing `nearbyRadiusMeters` and
its stated reason — a result should mean "the place you are standing in," not
"the whole block."

The two accuracy gates differ because the tiers rest on different evidence.
`geoConfirmed` gets identity from the *name*, so location only needs to
corroborate the neighbourhood; ±100 m is ample. `geoNearby` has nothing but
proximity, so a loose fix would manufacture confidence out of noise — a ±500 m
fix cannot support a 50 m uniqueness test. **All four numbers are initial and
must be confirmed against `probeCategoryBacklog.ts` output before implementation
lands**; the accuracy distribution it prints is what says whether the `geoNearby`
gate admits anything at all.

## 7. The ladder after this change

| # | Tier | Confidence |
|---|---|---|
| 1 | `userOverride` | certain |
| 2 | `merchantAlias` | certain |
| 3 | `observedMcc` | high |
| 4 | `emailDomain` | high |
| 5 | `brandPack` | high |
| **6** | **`geoConfirmed`** | **high** |
| 7 | `processorPrior` | medium |
| **8** | **`geoNearby`** | **low** |
| 9 | `none` | none |

`geoConfirmed` sits **below** `brandPack` deliberately. Order only matters when
two tiers both fire, and when the curated pack recognizes a brand we prefer its
editorial answer. Geo earns its keep in the case the pack misses entirely — an
independent merchant the pack has never heard of, standing at a corner Apple
knows.

`MerchantObservation` gains `placeCandidates` and `locationAccuracyMeters`. Both
new tiers carry `representativeMcc(category)` with `mccObserved: false`,
discharging the MCC obligation: `RuleMatcher` treats a NULL MCC as matching every
`mccInclude` rule unconditionally, so a category without one converts a
base-earn answer into a confidently wrong bonus.

## 8. Persistence

```prisma
model WalletEvent {
  placeOutcome    String?   // WalletPlaceOutcome as observed by the device
  placeCandidates Json?     // [{ name, poiCategoryRaw, distanceMeters }], ≤8
}
```

The **observation** is stored; the **mapping** is derived at read through the
vendored contract. This is the same discipline `suggestionFor()` already applies
in `src/app/purchases/page.tsx` — it recomputes rather than stores "because
storing it would freeze today's guess into a row and make a pack update
invisible." Storing the candidates is what makes a contract fix re-runnable
(§10), a bad match auditable, and the later learning decision (§11) a backfill
rather than a fresh collection effort.

`Purchase.categorySource` records `geoConfirmed`, which doubles as the
discriminator a safe re-run needs: a row still marked `geoConfirmed` has not been
touched by its owner, because an owner correction stamps `userOverride`.

## 9. Privacy

Two claims in `src/app/privacy/content.ts` change, and `policy-claims.test.ts`
must be updated with them.

1. **The categorization justification expires.** The policy says coordinates are
   retained because location "lets the server tell a coffee shop from a gas
   station." After this change the server is handed a *place*; the lookup happens
   on the owner's phone. The remaining honest purposes are the purchase-detail
   Maps link (LOG 2026-08-17) and auditing a bad match, and the policy must say
   so instead.
2. **Nearby shop names are newly stored.** `placeCandidates` holds the names of
   businesses near a tap that the owner did not necessarily buy from. This is new
   collection, it is not described by any current section, and it must be
   disclosed before the change ships.

Coordinate **retention is deliberately unchanged**. LOG 2026-08-17 keeps precise
coordinates "for now (the reversible choice)" pending a deliberate policy before
public launch; this design corrects a false justification without quietly
settling that separate ruling.

## 10. Contract, sync, and re-runs

`contracts/poi-categories.json` is generated from `CategoryMapper.swift` by a new
`scripts/generate-poi-categories.mjs` on the PickMe side, with `--check` gating
PickMe CI, and vendored through `sync-contracts.sh`'s `FILES` array — mirroring
`merchant-pack.json` exactly. Hand-writing a TypeScript copy of the POI switch is
**the refused option**: LOG 2026-08-19, 08-24, and 08-26 each record that
duplication happening once already.

`scripts/ops/reresolveGeoCategories.ts` re-derives `Purchase.category` for rows
where `categorySource = 'geoConfirmed'`, skipping any the owner has since
overridden. The `contract-sync` skill gains a step directing the next agent to
run it after vendoring a new POI contract, so the capability is a remembered
procedure rather than tribal knowledge.

`check:cards` is unaffected — it inspects `CreditCard` fields and
`src/lib/cards/*.ts` for `CardRewards`/`CARD_PRESETS`, and a POI→category table
is neither a rate model nor a per-user row.

## 11. OPEN, review by 2026-12-01: should a geo resolution teach anything?

**Deliberately not settled. Agents: this is open, not omitted. Do not resolve it
silently in an implementation — raise it with the owner.**

This design writes the purchase row and nothing else. `MerchantAlias` keeps its
documented meaning — *"someone decided this deliberately; the pack did not"* — and
only an owner's tap writes there, exactly as today.

**Why learning was deferred rather than rejected.** Learning adds nothing for
recurring wallet spend, because geo already re-resolves the same place correctly
every time. Its real payoff is *transfer*: wallet→Gmail (narrow — a merchant you
both tap at and receive receipts from) and user→user (broad, and the actual prize
at scale).

**Why not now.** `MerchantAlias` is keyed on `rawString` with **no `userId`** — a
global table. Auto-writing machine inference into it means one owner's bad mall
match silently recategorizes a descriptor for every user, with no attribution, no
audit trail, and no rollback, while laundering a `high`/`geoConfirmed` reading
into the `certain`/`merchantAlias` tier and destroying its provenance. LOG
2026-08-26 item (8) already flags the global posture as needing its own decision;
this would cash that hazard in at a much higher write rate.

**What would make it safe.** Scoped (per-user, or global only on corroboration),
provenance-preserving, and reversible. The promising rule is *corroboration
before promotion* — promote to global only when N **independent** users' geo
observations agree, the multi-user form of PickMe's `repeatedTerminal`
(`confirmationCount >= 2`). That threshold cannot be chosen or validated without
multiple users and recorded observations.

**Why this design is the prerequisite, not the alternative.** Because `§8` persists
the observation and `categorySource` records the tier, the learning table can be
built later and **backfilled from history**: every `(brandKey, place, category)`
where geo resolved and the owner never corrected it. Deciding the rule now would
mean picking a threshold with no data to check it against.

## 12. Testing

- `matchPlace.test.ts` — name agreement; the mall (many candidates → nothing); a
  lone POI inside and outside the tight radius; both accuracy gates; ties at each
  tier; `fullKey`-before-`brandKey` ordering.
- `resolveCategory.test.ts` — tier ordering (`brandPack` beats `geoConfirmed`;
  `geoConfirmed` beats `processorPrior`), and the MCC obligation on both new
  tiers.
- `capturePayload.test.ts` — a v2 payload **with** `place`, and one **without**,
  proving backwards compatibility for builds in the field.
- `poiPack` — the contract parses, and every POI category it maps resolves to a
  token `src/lib/categories.ts` offers, so a predictable category the owner
  cannot select fails CI. This mirrors the failure mode `categories.catalogue.test.ts`
  exists to prevent.
- PickMe: `WalletPlaceEnrichment` outcomes, and drain behaviour when the lookup
  fails (the event still uploads).

## 13. Explicitly not doing

- **Server-side Apple Maps calls.** Upholds LOG 2026-08-26.
- **Any write to `MerchantAlias`.** See §11.
- **A tier for coordinate-less rows.** The Gmail backlog needs different evidence;
  the resolver's doc comment already anticipates an LLM tier as one more `case`,
  and that is its own design.
- **Changing coordinate retention.** See §9.
- **Storing candidate coordinates.** Names, trades, and distances are sufficient.
