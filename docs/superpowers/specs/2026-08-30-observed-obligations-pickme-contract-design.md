# Observed obligations → PickMe contract

**Status:** Proposed, design only. No implementation and no PickMe changes are
part of this document.

**Recommendation:** Do not build P7 yet. Keep the design ready, complete P8's
measurement, collect owner confirmations, and separately ratify moving the
PickMe recurring audit out of the ecosystem's **Later** horizon. The safe
contract would produce an empty auditable set today.

## 1. Executive decision

When this integration is eventually built:

1. In Unity publishes a rich, versioned **observation** contract. It does not
   publish `RecurringPayment`, card categories, network-flag knowledge, card
   placement, accepted networks, FX conversions, or recommendations.
2. Static contract material flows **MoneyTalks → PickMe** through a dedicated
   sync with source commit and per-file SHA-256 provenance. Live owner data
   flows over an authenticated API and is never committed to either public
   repository.
3. PickMe vendors the schema and synthetic fixture exactly once, under an
   explicitly upstream-owned root. Swift and Kotlin tests read that one copy;
   neither language resource tree gets a checked-in copy.
4. The wire cadence stays rich. PickMe may narrow only after it has preserved
   the occurrence schedule needed by its cap projection. Seasonal months,
   future starts, anchors, and end-of-month clamping are never silently erased.
5. `RecurringPayment` remains owner-declared. A distinct observed wire type and
   a PickMe-owned enrichment step produce an auditable input without rewriting
   an observation as a declaration.
6. All confirmed observed lifecycle states may cross the contract, but only an
   `ACTIVE` obligation is eligible for the first audit adapter. `LAPSED` is not
   cancellation and contributes no projected spend or card recommendation.

This is a proposal, not a newly ratified ecosystem decision. No entry is added
to `docs/decisions/LOG.md` until the owner accepts the recommendation and gates.

## 2. Findings that change the priority

### There is no live hand-entered plan to replace

At PickMe commit `f30fc45088bb6a2ddbd6a80adf94473d787b0b75`,
`RecurringAuditor`, `RecurringPlan`, and `RecurringPayment` are pure engine
capability. Searches of `App/`, `Store/`, and the Android app/store find no
production caller. `placeholderSubscriptions` is exercised by Swift tests and
report tests, not by an app flow.

That matters because `ECOSYSTEM.md` explicitly says existing engine capability
does not authorize a surface, and places card ROI reporting in **Later**. P7 is
therefore not replacing a shipped manual workflow. It would create a new data
path toward a not-yet-authorized product surface.

### The safe result is empty today

The production snapshot supplied for this design has three detected rows for
one owner:

- two `anthropic.com`, both `LAPSED`;
- one `vercel.com`, `ACTIVE`;
- confidence between 0.35 and 0.50;
- zero owner confirmations.

An integration that admits unconfirmed rows would let judgment-based detector
scores affect card advice. An integration that requires confirmation, as this
design recommends, returns zero auditable rows. The latter is correct and has
no present product payoff.

### P8 is an instrument, not yet an answer

P8 has landed in `src/lib/domain/recurring/measurement.ts` and
`scripts/ops/reportRecurringMeasurement.ts`. It correctly separates blind
merchant recall, detected-series precision, and review-decision precision; it
suppresses a confidence curve below 30 evaluable decisions across four score
buckets; and it reports Wilson intervals.

The script itself labels its target as proposed rather than enacted:

> At least 90% detected-series precision over at least 50 independently
> labelled series, reported with its confidence interval.

The current three unconfirmed rows cannot satisfy or meaningfully challenge
that target. A single inbox is an instrument check, not evidence that the
detector generalizes.

### The copy-risk description has become stale

M7's diagnosis was true when written, but PickMe has since added:

- `scripts/sync-contracts-into-engine.sh`;
- `scripts/sync-contracts-into-android.sh`;
- Swift `ContractsSyncTests`;
- Kotlin `ContractsSyncTest`.

On 2026-08-30, both `card-catalogue.json` copies and both
`engine-fixtures.json` copies were byte-identical to their root contract, and
both language suites had byte-drift checks. The repository no longer relies on
discipline alone for those files.

The design constraint still holds: adding a network payload or its fixture to
both resource trees would add unnecessary generated surface and more sync work.
The right response is to avoid those copies, not to describe existing guards as
absent.

## 3. Ownership boundary

In Unity owns observations about obligations:

- merchant identity seen on the purchase spine;
- inferred or email-stated cadence;
- observed schedule history and amount pattern;
- lifecycle derived from obligation facts;
- confidence, algorithm version, and bounded evidence summary;
- whether the owner confirmed the detected series in In Unity.

PickMe owns every interpretation that can change a card decision:

- earn category and any representative MCC;
- current placement (`card`, `offWallet`, or unknown);
- accepted networks;
- `RecurringFlagStatus` (`assumed`, `confirmed`, or `refuted`);
- card and cap semantics;
- foreign-currency conversion into the engine's CAD value domain;
- whether a row is sufficiently complete and current to audit;
- the recommendation and its disclosures.

The hub contract deliberately omits `category`, `mcc`, `placement`,
`declaredAcceptedNetworks`, `flagStatus`, `amountCad`, and `annualCad`. Supplying
any of them would either invent unavailable evidence or move PickMe-owned
semantics into the hub.

The contract also omits raw email snippets, email IDs, purchase IDs, account
suffixes, and full evidence links. PickMe needs the observation, not the inbox.
An `obligationId` can deep-link back to In Unity if a future UX needs the audit
trail.

## 4. Two artifacts, two kinds of provenance

The word “contract” must not blur source code with owner data.

### Build-time contract release

MoneyTalks owns one public, personal-data-free release directory:

```text
contracts/observed-obligations/
  schema.json
  fixture.json
  RELEASE.json
```

- `schema.json` is the normative wire shape.
- `fixture.json` is synthetic and exercises every cadence and lifecycle case,
  including seasonal monthly billing, end-of-month clamping, null currency,
  and an empty obligations array.
- `RELEASE.json` names `observed-obligations-contract@1.0` and records the
  SHA-256 of the schema and fixture.

This release is separate from PickMe's `card-contracts@N`. Combining the two
would make a PickMe-owned card release appear to own an In Unity observation
contract.

### Runtime owner snapshot

An authenticated `GET /api/v1/observed-obligations` returns the current owner's
snapshot. It conforms to the released schema, but it does **not** carry a Git
`_upstream` block: a Git commit identifies the schema implementation, not the
mutable database state. Claiming that a commit produced particular owner rows
would be false provenance.

The response instead carries `contractVersion`, `generatedAt`, and an HTTP
`ETag` over the canonical response bytes. A successful empty array is distinct
from a transport failure. PickMe must never turn “request failed” into “owner
has no obligations.”

## 5. Runtime artifact shape

Illustrative v1 payload:

```json
{
  "contractVersion": "1.0",
  "generatedAt": "2026-08-30T22:45:00.000Z",
  "timeZone": "America/Toronto",
  "obligations": [
    {
      "obligationId": "opaque-stable-id",
      "origin": "DETECTED",
      "merchant": {
        "canonicalId": "vercel.com",
        "displayName": "Vercel"
      },
      "kind": "SUBSCRIPTION",
      "cadence": {
        "type": "MONTHLY",
        "dayOfMonth": 31,
        "startsFrom": "2026-01-31",
        "activeMonths": [1, 2, 3, 10, 11, 12]
      },
      "currency": "USD",
      "amountPattern": "FIXED",
      "schedule": [
        {
          "from": "2026-01-31",
          "amountMinor": 2000,
          "note": "observed stable run"
        }
      ],
      "lifecycle": {
        "status": "ACTIVE",
        "nextExpectedDate": "2026-10-31",
        "lastObservedDate": "2026-03-31"
      },
      "observation": {
        "algorithmVersion": 1,
        "confidence": 0.5,
        "reasons": [
          { "code": "REGULAR_OCCURRENCES", "delta": 0.35 }
        ],
        "confirmedAt": "2026-08-30T22:40:00.000Z",
        "evidenceSummary": {
          "occurrenceCount": 3,
          "firstObservedDate": "2026-01-31",
          "lastObservedDate": "2026-03-31",
          "sources": ["EMAIL"]
        }
      }
    }
  ]
}
```

### Shape rules

- `contractVersion` is `MAJOR.MINOR`.
- `generatedAt` and `confirmedAt` are ISO-8601 instants. Cadence, schedule,
  lifecycle, and evidence dates are owner-local ISO calendar dates interpreted
  in envelope `timeZone`.
- `obligationId` is stable and opaque. PickMe does not reconstruct identity
  from merchant, currency, cadence, or evidence membership.
- v1 exports only confirmed, non-dismissed `DETECTED` or `EMAIL_STATED` rows.
  `USER` and `MIGRATED` are declarations and need a separate future boundary.
- `currency` is uppercase ISO 4217 or null. A non-empty schedule requires a
  currency. Amounts are integer minor units; floats and implicit CAD are
  prohibited.
- `schedule[].from` and optional `to` are inclusive, matching `amountOn`.
- `activeMonths`, when present, is sorted, unique, and limited to `1...12`.
- `confidence` remains in `[0, 1]`, but confirmation—not a numeric cutoff—is
  the per-row export gate.
- `evidenceSummary` is intentionally non-identifying. No raw merchant email,
  subject, snippet, URL, database foreign key, or account discriminator crosses.
- Dismissed rows are absent rather than shipped with a flag. All confirmed
  lifecycle states, including `LAPSED` and `CANCELLED`, remain visible so the
  transport does not rewrite history for the consumer.

## 6. Versioning and refusal

PickMe declares `SUPPORTED_OBSERVED_OBLIGATIONS_MAJOR = 1` in each consuming
implementation. Decoding is two-stage:

1. decode only `contractVersion`;
2. parse and compare the major;
3. refuse an unsupported major before decoding `obligations`.

The ordering matters. A one-pass decode can fail on a child field before it can
say that the version is unsupported, or worse, accept a structurally decodable
payload whose meaning changed.

Version rules:

| Change | Version |
|---|---|
| Add an optional field with existing semantics | MINOR |
| Add a required field | MAJOR |
| Remove or rename a field | MAJOR |
| Change date, amount, null, or default semantics | MAJOR |
| Add a cadence, lifecycle, amount-pattern, origin, or evidence-source enum case | MAJOR unless every consumer already has an explicit lossless unknown case |
| Change export eligibility (for example, include unconfirmed rows) | MAJOR |

Unknown optional object keys from a newer minor are ignored. Closed enum values
are not silently mapped to `unknown`; an unrecognized value refuses that row or
snapshot according to the released major's documented policy. For v1, the whole
snapshot refuses so a partial plan cannot masquerade as complete.

An unsupported major is a product-visible “update PickMe to read this In Unity
contract” state. It is never an empty plan and never falls back to placeholder
subscriptions.

## 7. Sync direction and provenance

Do not reverse or broaden MoneyTalks' existing
`scripts/sync/sync-contracts.sh`. That script has one clear authority:
PickMe-owned card facts flow into the hub.

Add a future, dedicated PickMe script with the opposite, narrow authority:

```text
PickMe/scripts/sync-inunity-obligations-contract.sh
```

It vendors only the three public contract-release files into:

```text
PickMe/contracts/upstream/inunity/observed-obligations/
  schema.json
  fixture.json
  RELEASE.json
  MANIFEST.json
```

`MANIFEST.json` mirrors the discipline already proven by
MoneyTalks' `contracts/MANIFEST.json`:

```json
{
  "_upstream": {
    "repo": "https://github.com/zubairmuwwakil/MoneyTalks",
    "ref": "observed-obligations-contract@1.0",
    "release": "observed-obligations-contract@1.0",
    "commit": "full-40-character-commit-sha",
    "files": {
      "schema.json": "source-sha256",
      "fixture.json": "source-sha256",
      "RELEASE.json": "source-sha256"
    }
  },
  "schema.json": "destination-sha256",
  "fixture.json": "destination-sha256",
  "RELEASE.json": "destination-sha256"
}
```

The sync:

- supports a clean sibling checkout and an immutable remote tag/SHA;
- resolves any human ref to a full commit;
- refuses a dirty local source rather than recording false provenance;
- hashes source bytes before copying and destination bytes after copying;
- writes through a temporary manifest and atomic rename;
- never fetches or writes owner data;
- never changes PickMe's card-contract release number.

Verification is split deliberately:

- MoneyTalks `npm run check` validates the schema, fixture, release file list,
  and release digest.
- PickMe's normal Swift + Kotlin command validates its vendored hashes, release
  identity, supported major, and both decoders against the same fixture. It also
  includes a synthetic v2 fixture that must refuse.
- A networked freshness workflow compares the recorded upstream release to the
  current published release. Offline builds use the pinned vendored copy and do
  not depend on GitHub availability.

PickMe's `REPO_MAP.md` must be updated in the implementation commit to say that
`contracts/upstream/` is vendored external input, not PickMe-authored card data.

## 8. The copy answer

The contract gets **one** checked-in PickMe copy, not one per language:

```text
contracts/upstream/inunity/observed-obligations/fixture.json
```

Swift tests locate it from `#filePath`, the same repository-root technique
already used by `ContractsSyncTests`. Kotlin tests read the same root path or
configure it as a test input. Neither path requires the fixture at runtime,
because runtime data arrives over HTTP.

Therefore do not add any of these:

```text
Engine/Sources/CardCopilotEngine/Resources/observed-obligations*.json
Engine/Tests/CardCopilotEngineTests/Fixtures/observed-obligations*.json
android/core/engine/src/main/resources/.../observed-obligations*.json
android/core/engine/src/test/resources/.../observed-obligations*.json
```

If a tool later requires packaged test data, generate it into ignored build
output from the one root fixture. Do not check in the generated copy.

Swift and Kotlin wire structs are separate implementations, just as their
engines are separate implementations. Drift is caught by both decoding the
same positive and negative fixtures. Schema code generation is not justified
for this one small contract and would add a generator, generated-source policy,
and another failure mode before there is production value.

## 9. Cadence: preserve first, narrow only with proof

The wire uses MoneyTalks' full discriminated union unchanged:

```ts
type Cadence =
  | { type: "WEEKLY"; anchor: string }
  | { type: "BIWEEKLY"; anchor: string }
  | { type: "MONTHLY"; dayOfMonth: number; startsFrom?: string; activeMonths?: number[] }
  | { type: "QUARTERLY"; anchor: string }
  | { type: "SEMIANNUAL"; anchor: string }
  | { type: "ANNUAL"; anchor: string };
```

PickMe's flat enum is not a wire contract. Its losses are:

| Hub cadence | Flat-enum loss | Consequence |
|---|---|---|
| `WEEKLY` / `BIWEEKLY` | anchor | Annual count survives, but exact occurrence months near a cap-period boundary do not. PickMe currently spreads these evenly by month. |
| ordinary `MONTHLY` | `dayOfMonth`, optional future `startsFrom` | A future-starting plan can be annualized as though it had already run all year; the charge day and end-of-month behavior disappear. |
| seasonal `MONTHLY` | `activeMonths` plus the losses above | Mapping to `monthly` invents charges in inactive months and can overstate annual spend by `12 / activeMonths.count`. |
| `QUARTERLY` / `SEMIANNUAL` / `ANNUAL` | anchor day; without `nextChargeMonth`, anchor month too | Annual count survives, but cap crossing can move to the wrong month. |
| any day 29–31 | clamping rule | February and short-month occurrences cannot be reconstructed from the enum. |

The adapter should use the rich cadence to project explicit charge dates for
the audit window, then give PickMe's cap and value logic those projected
charges. It may display or retain the flat enum for declared plans, but it must
not round-trip an observed cadence through it.

This also exposes a current engine approximation rather than hiding it:
`CapProjector` spreads weekly, biweekly, and monthly spend evenly across months,
and relies on `nextChargeMonth` only for lumpy cadences. That is acceptable for
the declared approximation documented today; it is not a lossless consumer of
the observed contract.

## 10. Amount and currency are a second narrowing gate

Cadence is not the only mismatch.

MoneyTalks observes minor-unit schedules and distinguishes `FIXED`, `VARIABLE`,
`USAGE_BASED`, and `UNKNOWN`. PickMe's `RecurringPayment` requires one
`amountCad: Double`, multiplies it by `chargesPerYear`, and feeds that value to
cap projection. Mapping the latest variable charge to a fixed annual amount
would turn usage noise into a forecast without saying so.

The first adapter therefore accepts only:

- `amountPattern == FIXED`;
- a non-empty current schedule segment;
- a known currency;
- an `ACTIVE` lifecycle;
- a PickMe-owned conversion to CAD when currency is not CAD.

Variable, usage-based, and unknown rows may be shown as connected observations,
but they do not enter card value or cap math until PickMe defines and discloses
a projection policy. FX must come through the ecosystem's MarketLens boundary;
the hub contract never freezes a rate into an observation.

## 11. Observed is not declared

Do not initialize `RecurringPayment` from this payload. Its guarantee remains
true:

> One owner-declared recurring bill. Every field is a declaration; nothing here
> is observed.

The future PickMe flow has three layers:

```text
ObservedObligationSnapshot (Store; decoded from In Unity)
  + PickMe-owned enrichment
      category / MCC policy
      current placement
      accepted networks
      RecurringFlagStatus
      FX and audit-window charge projection
  → RecurringAuditCandidate (Engine; carries basis/provenance)
  → RecurringAuditor
```

`RecurringPayment` can separately adapt into the same neutral
`RecurringAuditCandidate`. That removes the auditor's accidental dependence on
all input being declared without weakening the declaration type.

The enrichment is not a bulk defaulting step:

- merchant identity does not imply PickMe's earn category;
- seeing recurring dates does not prove the network recurring flag;
- a purchase seen on one card does not prove current autopay placement;
- absent accepted-network evidence does not become universal acceptance;
- a hub confidence score does not become a PickMe flag state.

PickMe's existing `RecurringFlagStatus` remains entirely PickMe's. The hub does
not send it, name it, or default it.

## 12. Lifecycle handling

The transport preserves all confirmed observed lifecycle states. The proposed
v1 audit eligibility is deliberately narrower:

| Hub status | PickMe v1 treatment |
|---|---|
| `ACTIVE` | May proceed to the remaining enrichment and amount gates. |
| `TRIALING` | Not audited until a paid schedule and PickMe policy exist; may deep-link to In Unity. |
| `CANCELLING` | No annual recommendation. The current auditor assumes continuation and would overstate value. |
| `CANCELLED` | No projected spend and no recommendation. |
| `LAPSED` | No projected spend and no recommendation. Display as “charges stopped; cancellation not confirmed,” never as cancelled. |

This is why dropping status from the payload or flattening both terminal-looking
states to “inactive” is wrong. `LAPSED` is uncertainty about continued billing;
`CANCELLED` is evidence of cancellation. PickMe may make the same immediate
audit decision for both while preserving their different meaning and UX.

## 13. Build gates

Do not start implementation until all of these are true:

1. **Measurement:** P8 reports at least 90% detected-series precision over at
   least 50 independently labelled series, with its Wilson interval. The
   evaluation spans at least three owners; a single inbox remains an instrument
   check. Tuning and final evaluation use different labelled sets.
2. **Per-row trust:** only owner-confirmed, non-dismissed observations export.
   No confidence threshold substitutes for confirmation in v1.
3. **Product scope:** the owner explicitly moves this PickMe recurring-audit
   surface out of `ECOSYSTEM.md`'s Later horizon, or limits implementation to a
   non-surfaced contract experiment with no user-facing recommendation.
4. **Consumer semantics:** PickMe ratifies the missing-input workflow for
   category, placement, accepted networks, recurring flag, and FX. The hub does
   not choose these to make the integration easier.
5. **Cross-language contract:** the single vendored fixture, provenance
   manifest, runtime major gate, Swift decoder, and Kotlin decoder land as one
   coherent PickMe change. A Swift-only path would create a new twin gap.
6. **No placeholder fallback:** unavailable, incompatible, empty, and stale are
   four distinct states in PickMe. None falls back to
   `placeholderSubscriptions`.

The first production slice after the gates is intentionally small:

- MoneyTalks contract release and authenticated read endpoint;
- PickMe sync/provenance and decoders;
- local storage of the last successful snapshot;
- no recommendation until one row passes every explicit gate above.

## 14. Alternatives rejected

### Fill `RecurringPayment` directly

Rejected. It falsifies the type's declaration guarantee, invents missing
PickMe facts, and makes future code unable to tell observation from assertion.

### Publish a PickMe-shaped lossy DTO from the hub

Rejected. It makes MoneyTalks decide which cadence, lifecycle, amount, and card
semantics PickMe cares about. Seasonal billing and lapsed status disappear
before the rightful consumer can evaluate them.

### Commit a production JSON snapshot

Rejected. The repositories are public, owner financial data is mutable, and a
Git commit is the wrong transport and retention mechanism for it.

### Copy the fixture into Swift and Kotlin resources

Rejected. Runtime does not need the fixture, and both test suites can read one
root vendored copy. Existing copy guards reduce today's risk but do not justify
adding avoidable copies.

### Generate Swift and Kotlin from JSON Schema now

Rejected for the first release. The generator and generated-source lifecycle
would cost more than two small DTOs tested against one fixture. Revisit if the
contract family grows beyond this single envelope.

### Build the schema and sync now “for readiness”

Rejected. A dormant contract still creates versioning and freshness work, and
there is no live consumer or eligible production row. This design is the cheap
readiness artifact; executable infrastructure waits for evidence and scope.

## 15. Ratification effect

If the owner accepts this recommendation, amend the earlier P7 wording in the
decision log rather than adding a contradictory second source of truth:

- P7 is gated by P8 and PickMe product-scope approval;
- the hub publishes rich observations, not a generated PickMe cadence enum;
- `RecurringPayment` remains declared and a distinct observed boundary feeds a
  PickMe-owned audit candidate;
- confirmed `LAPSED` and `CANCELLED` observations transport distinctly but
  neither enters recurring card recommendations.

Until that acceptance, the existing 2026-08-29 P7 statement is historical
intent under review, and this document remains a recommendation.

## 16. Non-goals

- No recurrence detection, confidence, clustering, or lifecycle changes.
- No `Subscription` merge Phases 5–6.
- No change to PickMe, its card catalogue, merchant pack, or fixtures.
- No new card category, MCC, rate, cap, valuation, or network fact in the hub.
- No FX provider or market-data ingestion in either repository.
- No PickMe recurring-audit UI or product-scope change.
- No personal data committed to a contract, fixture, report, or design.
