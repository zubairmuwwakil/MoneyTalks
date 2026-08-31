# Subscription and recurring-obligation merge

**Status:** Ratified in chat 2026-08-30. Design only; no implementation is part
of this document.

## 1. Decision

`RecurringObligation` becomes the sole model for subscriptions. The older
`Subscription` and `SubscriptionPayment` tables are migrated, held read-only
for a rollback window, and then removed. The old `/api/subscriptions` namespace
and `/subscriptions` route survive for one release as compatibility adapters
over `RecurringObligation`; they never dual-write the old table.

The merge is a phased canonicalization, not a big-bang replacement and not a
permanent facade over two sources of truth.

The hard semantic rule is:

> Owners assert facts; the recurring sweep derives lifecycle status.

An owner cancelling a subscription therefore records a durable cancellation
fact. It does not mutate `RecurringObligation.status`. A later charge or an
explicit owner resumption can supersede that cancellation in temporal order.

## 2. Context

`docs/decisions/2026-08-30-email-fact-lane.md` ratified that email facts feed
`RecurringObligation` only. It explicitly left the `Subscription` overlap as
acknowledged debt and named `/api/recurring` as the accurate surface. This
design pays that debt.

The overlap is not merely two names for the same table:

- `Subscription` stores one mutable amount, a narrow cadence enum, one renewal
  date, an owner-mutable `ACTIVE | CANCELLED` status, cancellation help, a
  trial boundary, and manually recorded payments.
- `RecurringObligation` stores inferred cadence quality, amount patterns and
  schedule history, typed confidence reasons, evidence links, series identity,
  origin, review decisions, and a lifecycle status derived from evidence.

Keeping both would guarantee disagreement. Feeding both from the email lane
would make the disagreement systematic.

### `MIGRATED` was reserved for this work

`ObligationOrigin.MIGRATED` appears in the original recurring-obligations
schema, migration, and design. That design's migration section explicitly says
legacy subscriptions use `origin = MIGRATED`. The value is written nowhere in
the application today. This is not an unused generic escape hatch: it was put
there for this backfill and this design uses it.

`MIGRATED` means that the migration created the obligation row. If an existing
`DETECTED` or `EMAIL_STATED` obligation absorbs a legacy subscription, it keeps
its actual origin; the legacy mapping and migrated owner facts record the
absorption. Rewriting an existing row's origin would destroy true provenance.

Origin records how the row entered the system. It does not decide whether the
sweep may derive it. The current blanket protection for `origin = USER` must
be replaced by field- and fact-level precedence so every origin participates
in lifecycle folding.

## 3. Goals and boundaries

### Goals

- One source of truth for subscriptions and other recurring commitments.
- Lossless preservation of real owner data from `Subscription`,
  `SubscriptionPayment`, and resolvable subscription-related `DetectedItem`
  decisions.
- Lifecycle status remains derived from auditable evidence.
- Owner edits survive future sweeps without freezing the entire obligation.
- A conservative, idempotent data migration with a stated rollback boundary.
- Temporary compatibility for callers of the old routes without dual writes.
- No personal data in migration fixtures, documentation, or reports committed
  to this public repository.

### Non-goals

- Retiring `Bill`. The previously ratified recurring design still points
  toward Bill convergence, but this migration does not combine two retirements.
- Changing recurrence detection, confidence weights, clustering tolerances, or
  email extraction except where owner facts must join the existing fold.
- Adding an LLM.
- Preserving the old `confirm-detection` endpoint under a new name.
- Building implementation code in this design task.

## 4. Alternatives considered

### A. Big-bang replacement

Backfill, switch every reader and writer, and drop the old tables in one
release. This reaches the smallest schema fastest but puts reconciliation,
legacy IDs, notifications, and rollback on one irreversible boundary. Rejected
because the tables hold real owner data.

### B. Phased canonicalization with read-only compatibility adapters

Add the missing canonical concepts, reconcile and backfill, freeze old writes,
serve old URLs from the new model, migrate internal readers, validate for one
release, then drop the legacy tables. This establishes one source of truth at
cutover while retaining a bounded rollback window. **Chosen.**

### C. Permanent unified facade

Keep both models and resolve conflicts in a service on every read. This lowers
initial migration pressure but preserves two owners of the same fact and makes
status precedence a permanent runtime problem. Rejected because it renames the
debt rather than removing it.

### Explicitly rejected: dual writes

The 2026-08-29 design proposed a dual-write phase. It is rejected here. Dual
writes do not make this migration safer because the two schemas cannot express
the same states: `LAPSED`, quarterly cadence, schedule history, evidence, and
owner facts have no lossless legacy projection. A projection-agreement check
would either fail on valid richer data or quietly ignore it. The old tables are
rollback material, not a second live model.

## 5. Canonical obligation shape

`RecurringObligation` gains descriptive owner metadata:

| Field | Meaning |
|---|---|
| `displayName` | Owner-facing label; separate from canonical merchant identity. |
| `notes` | Owner-authored free text. |
| `cancellationUrl` | Direct cancellation destination when known. |
| `cancelInstructions` | Owner- or product-authored cancellation guidance. |

These are ordinary mutable metadata because they describe how to recognize or
manage an obligation. They are not claims about what happened in time.

`trialEndAt` does **not** become a mutable column. A trial boundary is temporal
evidence and belongs in the fact stream.

### Merchant identity may be unknown

`Subscription.merchantCanonicalId` is nullable, and an owner can legitimately
create a subscription before the product can resolve its merchant. Migration
must not invent a canonical id from `name` or store a sentinel that looks like
a merchant.

`RecurringObligation.merchantCanonicalId` therefore becomes nullable for
owner-created and migrated obligations. Detection still requires a real
canonical merchant. A stable `seriesKey` derived from the legacy row or new
owner-created row supplies identity when merchant is absent. Persistence uses
partial unique indexes for the known-merchant and unknown-merchant cases;
neither display name nor a fake merchant participates in identity.

Migrated and compatibility-created rows use `kind = SUBSCRIPTION`.

## 6. Owner facts

Add an append-only `RecurringObligationOwnerFact` relation. It is the durable
home for owner assertions that affect cadence, amount, evidence, or lifecycle.

### Fact types

| Type | Required payload | Use |
|---|---|---|
| `CHARGE` | occurrence, amount, currency | A manually recorded or migrated payment. |
| `EXPLICIT_CADENCE` | cadence | Owner-selected cadence. |
| `NEXT_BILLING_DATE` | billing date | Owner-selected next renewal. |
| `PRICE_CHANGE` | amount, currency, effective date | Initial or edited price. |
| `TRIAL_STARTED` | occurrence/effective date | Known trial start. |
| `TRIAL_ENDED` | effective date | Known trial boundary. |
| `ACTIVATION` | occurrence | Initial active assertion. |
| `CANCELLATION` | occurrence and optional effective date | Owner says cancellation occurred or will take effect. |
| `RESUMPTION` | occurrence | Owner explicitly reactivates after cancellation. |

The persisted model carries:

- owner and obligation ids;
- fact type;
- source (`OWNER_ACTION`, `MIGRATED_SUBSCRIPTION`, or
  `MIGRATED_SUBSCRIPTION_PAYMENT`);
- a stable, unique source key for idempotency;
- `recordedAt`, `occurredAt`, and the type-specific effective or billing date;
- nullable typed payload fields for amount, currency, and cadence;
- an optional `supersedesId` for edits that replace an earlier owner assertion.

Application validation enforces the payload required by each type. Empty or
contradictory payloads are rejected rather than interpreted.

### Why owner facts instead of override columns

A set of `ownerStatus`, `ownerAmount`, `ownerCadence`, and `ownerNextDate`
columns would recreate `Subscription` inside `RecurringObligation`, erase
history, and require bespoke precedence for each new field. Facts use the
existing evidence architecture, remain auditable, and preserve what an owner
said before a later edit superseded it.

### Configuration precedence

For cadence, next billing date, and price:

1. the latest applicable, non-superseded owner fact;
2. direct email facts;
3. purchase-based inference.

An owner correction remains authoritative until the owner supersedes it. The
sweep may still incorporate new evidence and derive lifecycle status.

### Lifecycle precedence

Lifecycle is chronological rather than a permanent source override:

- facts fold by their temporal meaning;
- a later cancellation outweighs older charges;
- a later charge, activation, or resumption clears an older cancellation;
- equal-time conflicts resolve deterministically as owner fact, then email
  fact, then purchase occurrence;
- `LAPSED` means evidence stopped, never that the owner cancelled;
- the existing grace band between active and lapsed remains unnamed.

This is the ratified meaning of owner cancellation: a durable assertion about
the timeline, not a command to hide the record forever.

## 7. Derived status remains derived

`RecurringObligation.status` already exists in persistence, while the domain
comment says it "must never become a mutable column." The consistent reading
is that the stored field is a sweep-owned projection/cache, never an owner- or
API-mutable input.

Only the lifecycle fold writes the projection. API actions append facts and
then rederive. No route accepts a raw lifecycle-status assignment.

The sweep must no longer skip an obligation merely because its origin is
`USER`. `USER` and `MIGRATED` rows can have new charges, cancellation emails,
trial facts, or lapses. Owner facts protect the assertions that need protection
without freezing the rest of the row.

## 8. Legacy field mapping

Each `Subscription` is translated as follows:

| Legacy field | Canonical destination |
|---|---|
| `name` | `displayName` |
| `notes` | `notes` |
| `cancelUrl` | `cancellationUrl` |
| `cancelInstructions` | `cancelInstructions` |
| `merchantCanonicalId` | canonical merchant when present; null remains null |
| `amountCents`, `currency` | initial `PRICE_CHANGE` owner fact |
| `renewalDate` | `NEXT_BILLING_DATE` owner fact |
| `MONTHLY` | monthly `EXPLICIT_CADENCE` owner fact anchored to renewal day |
| `YEARLY` | annual `EXPLICIT_CADENCE` owner fact anchored to renewal date |
| `CUSTOM` | provisional monthly fact on renewal day, with migration review required |
| `trialEndAt` | `TRIAL_ENDED` owner fact whose effective date is the stored boundary |
| `ACTIVE` | `ACTIVATION` owner fact at legacy creation time |
| `CANCELLED` | `CANCELLATION` owner fact at legacy `updatedAt` |

`Subscription` has no `cancelledAt`. Using `updatedAt` is therefore an
approximation, and the fact's migrated provenance must say so. The migration
must not claim a more precise timestamp than the source provides.

Every `SubscriptionPayment` becomes a `CHARGE` owner fact with its original
payment id in the source key, plus the stored date, amount, currency, and notes
where supported. It does not create a `Purchase`: doing so would fabricate a
canonical transaction and source provenance the old row never had.

Legacy source keys are deterministic, for example one key per subscription
field assertion and one per payment id. Re-running the backfill is a no-op.

## 9. Conservative reconciliation

The migration first attempts to reconcile a legacy subscription with an
existing recurring obligation. It auto-merges only when exactly one candidate
has all of:

- the same owner;
- an exact, non-null canonical merchant id;
- the same currency;
- compatible cadence;
- materially compatible current amount;
- an expected date within the cadence's existing tolerance.

No name-only, fuzzy-name, or amount-only matching is permitted. A null legacy
merchant never auto-merges.

If exactly one candidate qualifies, the migration:

- preserves the existing obligation id and origin;
- adds the legacy mapping;
- copies descriptive metadata without overwriting a non-empty owner value
  unless the migration is the only owner source;
- adds idempotent migrated owner facts;
- preserves all existing purchase and email evidence.

If no candidate or more than one candidate qualifies, the migration creates a
separate obligation with `origin = MIGRATED`, a deterministic series key, and
a migration review reason. A temporary duplicate is preferable to silently
combining two plans, accounts, or currencies.

### Legacy mapping

A temporary one-to-one mapping stores legacy subscription id, canonical
obligation id, reconciliation outcome (`MERGED` or `CREATED`), migration time,
and a non-personal diagnostic reason code. It serves:

- idempotent backfill;
- compatibility routes using legacy ids;
- notification-source rewrites;
- rollback and reconciliation reports.

The mapping remains until all legacy references are rewritten and the
compatibility window closes.

## 10. Meaning of confirmation

The two old confirmation concepts are not equivalent:

- `RecurringObligation.confirmedAt` records that the owner accepted a detected
  obligation and snapshots `decidedConfidence` and `decidedReasons` for model
  measurement.
- `/api/subscriptions/[id]/confirm-detection` merely marks a lossy
  `DetectedItem` confirmed and attaches it to a subscription.

The latter adds no fact the recurring model lacks. It does not preserve the
email fact payload, create a payment occurrence, or snapshot the detector's
typed confidence. It is retired rather than translated.

If an owner needs to correct entity resolution, the canonical operation is
explicit: assign or move a particular `RecurringObligationEvidence` link to a
particular obligation. Confirmation and evidence assignment remain separate
actions.

## 11. Existing `DetectedItem` rows

New subscription-shaped `DetectedItem` rows stop being produced. The email
fact lane and recurring review surface replace them. Bill-shaped detected
items are outside this merge.

Existing owner decisions are migrated where provenance permits:

- Resolve `sourceEmailId` to the owner's email transaction and then to its
  email facts.
- A confirmed item linked to a subscription becomes an evidence assignment to
  the mapped obligation when exactly one source fact is identifiable.
- A dismissed item marks the corresponding evidence excluded when the fact and
  target obligation are unambiguous.
- Never guess across several facts in one email; multi-subscription receipts
  are precisely why `EmailObligationFact.factKey` exists.
- Unresolvable rows remain read-only and exportable during the compatibility
  window, and their aggregate count appears in migration validation. No
  committed report contains merchant, email, snippet, or owner data.

`DetectedItem.subscriptionId` is removed with the legacy relation. The
canonical evidence link is `RecurringObligationEvidence`, not another foreign
key from the old projection.

## 12. Canonical and compatibility APIs

`/api/recurring` remains the accurate namespace. It grows canonical operations
for listing all obligations, creating an owner obligation, editing descriptive
metadata, appending typed owner facts, reviewing a detection, excluding or
reassigning evidence, and resolving currency.

For one release:

- `GET /api/subscriptions` reads recurring obligations through the legacy map.
- `POST /api/subscriptions` creates a `USER` recurring obligation plus owner
  facts; it never creates `Subscription`.
- `GET /api/subscriptions/[id]` resolves the old id through the map.
- `PATCH /api/subscriptions/[id]` updates metadata or appends typed owner facts.
- `/api/subscriptions/[id]/confirm-detection` is retired and returns a clear
  deprecation response rather than performing a partial translation.
- compatibility responses carry deprecation headers and include the accurate
  lifecycle status beside any legacy projection.

The old two-state status is necessarily lossy. Compatibility may project an
explicit derived `CANCELLED` as legacy `CANCELLED` and other states through the
old active shape, but it must also return `lifecycleStatus`; internal code may
not consume the lossy field. `/api/recurring` is authoritative throughout.

`/subscriptions` remains a user-facing route during the transition but reads
the canonical model. It can present richer states rather than imitating the
old `ACTIVE | CANCELLED` filter.

## 13. Downstream cutover inventory

Before legacy tables can be dropped, the implementation must move every
subscription reader or reference discovered in the current tree:

- renewal and trial events in `/api/events`;
- renewal notification scheduling and the notify cron;
- value-at-risk summaries;
- subscription transaction history;
- automation suggestion confirmation;
- `/subscriptions` and its inline edits;
- notification links and `sourceKind = subscription` references;
- data export, deletion, summary, and privacy-count surfaces;
- user relations and Prisma types;
- tests, fixtures, and guardrails that mention `Subscription` or
  `SubscriptionPayment`.

New notifications use the recurring obligation id and a canonical source kind.
Existing future notifications are repointed through the legacy map without
discarding their read/dismissed state. Historical notifications may retain
their old source metadata while their link resolver still understands the map.

Bill readers are not part of this cutover.

## 14. Migration phases

### Phase 0 — inventory and dry run

Run a read-only reconciliation that reports aggregate counts: rows, payments,
exact matches, unmatched rows, ambiguous rows, null merchants, custom cadence,
detected-item decisions, and validation failures. Logs and committed fixtures
contain synthetic identifiers only.

### Phase 1 — additive schema

Add descriptive metadata, nullable merchant identity support, owner facts, and
the legacy mapping. Existing application behaviour is unchanged.

### Phase 2 — transactional backfill

Process bounded owner batches. Each legacy subscription, its payments, its
mapping, and its migrated facts commit atomically. Source keys and mapping
uniqueness make retries safe.

### Phase 3 — validation

Compare canonical projections with legacy rows, prove payment/fact coverage,
and surface ambiguous or unresolvable cases. Do not cut over on a count
mismatch or an unmapped subscription.

### Phase 4 — canonical writes and compatibility reads

Freeze old tables. All old and new endpoints write only the canonical model.
Old tables remain untouched as rollback material. Internal readers move in
small commits.

### Phase 5 — observation window

Keep compatibility for one release. Monitor adapter use, reconciliation
reviews, duplicate reports, notification counts, export/delete success, and
backfill idempotency.

### Phase 6 — retirement

After backup and final validation, remove compatibility endpoints, mapping,
old relations, enums, `Subscription`, and `SubscriptionPayment`. Remove old
notification resolution only after all live references are rewritten.

Database migrations remain a separate deploy step under the repository's
standing build policy; they never move into `npm run build`.

## 15. Reversibility

The migration has two different rollback guarantees, and the distinction is
material.

### Before canonical writes

Rollback is fully reversible. The old tables are still authoritative and
untouched. Delete rows and facts identified by the legacy map, remove the
additive schema, and resume old code.

### After canonical writes begin

The old tables are stale by design. Rollback requires an explicit reverse
projection. Monthly and annual owner subscriptions can be projected back, but
the old schema cannot losslessly represent weekly, biweekly, quarterly,
semiannual, lapsed, cancelling, evidence exclusions, or schedule history.

This phase is reversible for the migrated legacy data, but not losslessly for
all new canonical capabilities. Claiming otherwise would require the rejected
dual-write system and still would not solve the vocabulary mismatch.

### Final drop

Dropping the legacy tables is the declared point of no return. It requires:

- a restorable database backup;
- zero unmapped subscriptions;
- zero uncovered subscription payments;
- no live legacy writers or readers;
- successful export and deletion checks;
- completion of the compatibility observation window.

## 16. Validation and tests

### Migration invariants

- Every `Subscription` has exactly one legacy mapping.
- Every `SubscriptionPayment` has exactly one migrated `CHARGE` owner fact.
- Every non-null cancellation URL, instruction, note, and trial boundary is
  preserved.
- No owner-fact source key is duplicated.
- A second backfill changes zero rows.
- Exact reconciliation never produces two mappings for one obligation unless
  the product explicitly supports that case; the initial migration does not.
- Ambiguous and unresolvable rows are counted and reviewable.
- No legacy write path remains after cutover.

### Domain cases

- Owner cancels immediately.
- Owner schedules a future cancellation.
- Email cancellation follows an older charge.
- Owner resumes after cancellation.
- A later real charge indicates resubscription.
- Trial begins, ends, and converts to a charge.
- Charges stop and the obligation lapses without being labelled cancelled.
- Owner cadence and price corrections survive later sweeps.
- Equal-time source conflicts resolve deterministically.
- A migrated active assertion does not erase a later cancellation email.
- A migrated cancelled timestamp is marked approximate.

### Reconciliation cases

- One exact merchant/currency/cadence/amount/date match merges.
- Same merchant with two plans is ambiguous and does not merge.
- Same merchant in two currencies does not merge.
- Null merchant never fuzzy-matches on display name.
- Custom cadence creates a reviewable provisional mapping.
- Multi-subscription email facts never collapse by message id alone.

### Surface cases

- Legacy ids resolve through adapters.
- Legacy PATCH appends facts rather than mutating derived status.
- Canonical and compatibility reads agree on representable fields.
- `confirm-detection` performs no hidden write.
- Notifications do not duplicate across source-id migration.
- Data export includes metadata, owner facts, evidence, and migrated provenance.
- Account deletion removes the new relations without foreign-key failures.

Implementation uses the repository's single checklist, `npm run check`, plus
the database-backed migration verification appropriate to the eventual schema
change. This design introduces no second checklist.

## 17. Privacy and observability

This public repository receives no production row dumps, merchant lists,
emails, snippets, notes, URLs, or owner identifiers. Migration fixtures are
synthetic. Operational output uses aggregate counts and opaque ids only.

Useful aggregate signals are:

- created, merged, ambiguous, and unmatched subscriptions;
- migrated and skipped payment counts;
- unresolved detected-item decisions;
- adapter request counts by route;
- lifecycle projection failures;
- notification rewrites and collision counts;
- reverse-projection incompatibility counts during rollback rehearsal.

## 18. Completion criteria

The debt is closed only when:

1. `RecurringObligation` is the only subscription source of truth.
2. Owner cancellation is represented as evidence and status remains derived.
3. Cancellation help, trial boundaries, payments, notes, and legacy decisions
   have a documented canonical home.
4. `MIGRATED` is used only for rows actually created by migration.
5. `/api/subscriptions` contains no legacy persistence writes.
6. `confirm-detection` and `DetectedItem.subscriptionId` are retired.
7. All downstream readers use the canonical model.
8. Migration validation is clean and rollback limits are explicit.
9. The compatibility window ends and the old tables are removed after backup.

Until criterion 9, the merge is in transition. After it, `/api/recurring` and
the recurring-obligation domain are the sole accurate subscription surface.
