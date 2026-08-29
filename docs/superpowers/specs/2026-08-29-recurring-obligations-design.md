# Recurring obligations: detection, model, and contract

Status: design ratified in chat 2026-08-29. Not yet implemented.

Detects and models recurring money commitments — subscriptions, household
bills, utilities, memberships, insurance, telecom, SaaS, domain renewals,
loans, annual fees, trials — from what the hub already observes, and publishes
them as a contract PickMe consumes.

## 1. Decisions ratified

| Question | Ruling |
|---|---|
| Which repo | **MoneyTalks.** `return-saas` stays frozen (B1); its parser is a stale fork of ours. |
| Detection substrate | **The `Purchase` spine**, not the email stream. Email supplies facts a charge cannot. |
| Model shape | **One `RecurringObligation` with a `kind` discriminator.** `Bill` and `Subscription` collapse into it. |
| Cadence vocabulary | **Extend `src/engine/recurrence.ts`'s `Cadence`** with `WEEKLY` + `SEMIANNUAL`; ship via `contracts/` so PickMe stops hand-maintaining its own enum. |
| History depth | **One-time 24-month backfill on connect**, then the existing 90-day incremental. |
| Autonomy | **Always review.** Nothing auto-creates. Batch-confirmable in the existing review inbox. |
| Multi-account | **In scope.** Drop `EmailConnection.userId @unique`. |
| `Subscription.cadence = CUSTOM` rows | Migrate to `MONTHLY` at `renewalDate`'s day, flagged for re-detection. |
| Backfill consent | **User-initiated, strongly prompted.** Never silent on connect. |
| Data retention | **Deferred** — see §15, D1. |
| LLM | **No.** See §12. |

### Why not `return-saas`

A service boundary is a cache boundary or it is a liability. MarketLens earns
one: its data is impersonal (one fetch of AAPL's close serves every user), it
compresses (a price from an ocean of OHLCV), and it holds no caller secrets.
Email intelligence scores zero on all three — per-user data with no cross-user
cache value, an answer that requires joining against the wallet/statement spine
the service would not have, and custody of Gmail refresh tokens. Splitting it
out buys a second credential store, a second `SECRET_ENC_KEY_V<n>` hierarchy,
and a Google restricted-scope production verification for a repo we have
declared frozen.

## 2. Current state

### Reused as-is

- `src/lib/domain/receipts/receiptEvidence.ts` — `classifyReceiptEmail` already
  implements the correct precedence (subscription word **and** money word →
  order → bill → `null`) and `hasPurchaseEvidence` already gates newsletters.
- `src/lib/domain/receipts/emailMerchant.ts` + `MerchantAlias` — merchant
  identity shared with wallet taps, which is what lets a receipt and a tap merge.
- `contracts/merchant-pack.json` + `merchantPack.ts` — canonical merchant ids
  with `emailDomains`, `matchKeys`, `mcc`. PickMe owns these facts.
- `src/lib/domain/spine/purchaseMerge.ts` — cross-source dedup.
- `src/engine/recurrence.ts` — `Cadence`, `ScheduleEntry[]`, `amountOn()`,
  `occurrencesBetween()`. Already richer than any flat `{interval, unit}` model:
  it carries anchors, end-of-month day clamping, and `activeMonths` for
  seasonal utility billing.

### Defects this work removes

1. `src/app/api/automation/scan/route.ts:176-180` — a subscription's renewal
   date is fabricated as `detected + 30 days` with `cadence = "MONTHLY"`,
   regardless of evidence.
2. `src/app/api/automation/scan/route.ts:184-186` — a bill's `dueDayOfMonth` is
   fabricated as `detected + 7 days`. That number has no basis in the email and
   is written into a real `Bill` at `suggestions/route.ts:289`.
3. `src/app/api/automation/scan/route.ts:60-62` — `detectSubscriptionItem`
   returns `RENEWAL` unconditionally on fall-through. `null` is the honest
   answer, exactly as `classifyReceiptEmail` already concluded one layer up.

All three are the same class of bug: a nullable domain fact meeting a
non-nullable column, where the type system is satisfied by an invented value.

4. `src/lib/domain/receipts/gmailPurchaseParser.ts:38-50` — **merchant identity
   is a two-label suffix slice.** `parts.slice(-2).join(".")` maps
   `notifications@shopify.co.uk` to `"co.uk"`, collapsing every UK merchant
   into one; likewise `.com.au`, `.co.nz`, `.gov.uk`. It also never consults
   `merchantPack.emailDomains`, so PickMe's curated merchant identity is
   bypassed on the email path in favour of four hardcoded brands.

   This is a **false-merge**, which is strictly worse than a miss: it yields a
   confident wrong obligation with a high evidence count. Every obligation in
   this design keys on merchant identity, so detection quality is bounded by
   this function. Fix: registrable domain via the Public Suffix List
   (`tldts`), then `merchantPack.emailDomains` lookup ahead of any heuristic.
   Promoted to P0 (§14) — it is a prerequisite, not a component, and it
   independently improves purchase merging and categorization today.

### Divergence this work stops

`Bill` and `Subscription` are converging on one concept from opposite
directions. `Bill` gained `cancellationUrl`, `billingUrl`, `serviceUrl`,
`loginIdentifier`, `credentialLocation`, `billerKind` in `4be8270`;
`Subscription` already had `cancelUrl`, `cancelInstructions`. `cancelUrl` and
`cancellationUrl` are the same field with two spellings.

Meanwhile `Subscription.cadence` is `MONTHLY | YEARLY | CUSTOM`, so it cannot
represent a biweekly loan or a quarterly water bill; and its single mutable
`amountCents` cannot record a price increase at all, while `Bill` has had
`ScheduleEntry[]` history the whole time.

Four incompatible cadence vocabularies exist today:

| Where | Vocabulary |
|---|---|
| `return-saas` Prisma | `MONTHLY \| YEARLY \| CUSTOM` |
| MoneyTalks Prisma | `MONTHLY \| YEARLY \| CUSTOM` |
| MoneyTalks engine | `BIWEEKLY \| MONTHLY{dayOfMonth,activeMonths} \| QUARTERLY \| ANNUAL` |
| PickMe Swift | `weekly \| biweekly \| monthly \| quarterly \| semiAnnual \| annual` |

## 3. Architecture

```
src/lib/domain/recurring/
  clustering.ts        Purchase[]                → CandidateCluster[]
  cadenceInference.ts  Date[]                    → { cadence, coverage, mad } | null
  amountPattern.ts     Observation[]             → { pattern, schedule: ScheduleEntry[] }
  emailSignals.ts      EmailTransaction[]        → ObligationFact[]
  confidence.ts        cluster + facts           → { score, reasons: Reason[] }
  lifecycle.ts         ObligationFact[]          → ObligationStatus
  detectRecurring.ts   orchestration (only impure module)
```

Every module but `detectRecurring.ts` is a pure function over plain data,
testable from fixtures with no database. `src/engine/recurrence.ts` gains
`WEEKLY` and `SEMIANNUAL`; nothing else there changes.

### Data flow

```
Gmail / IMAP
  → EmailTransaction  (+ connectionId, RFC822 dedup)
  → Purchase          (spine; already merged with wallet taps + statement lines)
  → [nightly sweep]   group by canonical merchant → clusters
  → confidence + lifecycle
  → AutomationSuggestion(kind=RECURRING)
  → review inbox (/settings/automation/review)
  → RecurringObligation
```

Detection is a **re-runnable sweep, not a per-message side effect**. The sweep
runs on the existing claim-based job queue (`claimDueDigestJobs` in
`src/lib/domain/notifications/digestJobScheduler.ts`), never in a request
handler.

Re-runnable does not mean "recompute everything nightly" — that is
`O(users × purchases)` of mostly unchanged answers. Two mechanisms keep it
bounded:

- **Dirty-merchant scoping.** A nightly pass sweeps only merchants touched by
  `Purchase` rows with `updatedAt > lastSweptAt`. Nothing else can have changed.
- **`algorithmVersion` on the obligation.** When the deployed version exceeds
  the stored one, that row is stale and re-derives on its own schedule. This is
  the actual mechanism behind "improve the algorithm and re-run": a rolling
  backfill rather than a data migration, and it bounds the blast radius of a
  bad tuning change to the rows swept since deploy.

### Why the spine, not email

Detecting on email alone is structurally blind to every recurring charge that
does not email you — gyms, most Canadian telecom, pre-authorized debits,
anything the user has unsubscribed from marketing on. Those are precisely the
household bills the feature is for. The spine already merges wallet taps and
statement lines, so reading it gets those for free.

It also changes the problem's shape. On email, recurrence is a text problem and
the complexity budget goes to keyword lists and event taxonomies. On the spine,
it is a time-series problem where "regular" has a mathematical definition, and
email keywords demote from *the evidence* to *a prior*.

## 4. Recurrence algorithm

### Clustering

Cluster key: `(userId, canonicalMerchantId, currency, discriminator?)`.

`canonicalMerchantId` resolves in strict priority order — `merchantPack`
`emailDomains` / `matchKeys` first, then the user's `MerchantAlias`, then the
**registrable domain** (Public Suffix List, not a two-label slice). See §2
defect 4; this ordering is the difference between an obligation and a
false merge.

`currency` is in the key because coefficient of variation across mixed
currencies is meaningless, and because a merchant that switches billing
currency genuinely *is* a new obligation. For a Canadian product with
USD-billed SaaS this is a first-week bug, not an edge case.

Merchant alone is wrong. Amazon Prime bills $10.99/month from `amazon.com`, and
so do forty unrelated orders; merchant-only clustering yields "40 observations,
chaotic intervals → not recurring" and misses Prime entirely. Amount alone is
also wrong — it breaks a variable utility ($82 / $105 / $94).

The resolution is that neither is the key: within a merchant we **search for a
regular subsequence**. Prime's twelve charges form a clean 30-day subsequence;
the other orders never join it. The variable utility's dates are regular even
though its amounts are not, so it is found by the same search.

`discriminator` is a new nullable field populated from email evidence only
(account suffix, plan name) and never guessed. It separates two AWS accounts,
iCloud from Apple One, two Netflix households. Null is the common case.

### Cadence inference

For each candidate period `P ∈ {7, 14, 30, 91, 182, 365}` days:

1. Sort observations by date.
2. Greedily extract the longest subsequence whose consecutive gaps fall within
   `P ± tolerance` (±2d weekly, ±4d monthly — month lengths vary, ±10d annual).
3. `coverage = matched / expected_in_span`; `regularity = 1 − MAD/median`.
4. Score `= coverage × regularity`. Take the best-scoring `P`.

Accept when `n ≥ 3` matched, `coverage ≥ 0.75`, and MAD within tolerance.

**Exception:** `n = 2` suffices when email states the cadence explicitly
("renews monthly", an explicit next-billing date). An explicit fact beats
inference; this is the only path by which a newly-started annual subscription
is detectable before its second year.

Median absolute deviation, not standard deviation: one skipped or re-tried
charge should not disqualify an otherwise-clean twelve-month history.

Anchor: for `MONTHLY`, the median day-of-month of matched occurrences. For the
others, the most recent matched occurrence.

`nextExpectedDate = occurrencesBetween(cadence, today, today+90d)[0]` — reuse
the tested projector rather than writing a second one.

### Amount pattern

Run **changepoint detection first**. If amounts form two contiguous stable runs
(15.99×6 then 17.99×6), that is a price increase, not variance: emit two
`ScheduleEntry` rows. This is why `schedule: ScheduleEntry[]` is the amount
model and a mutable `amountCents` is not — a price history answers "what did
Netflix cost me in March?", which year-over-year spend and PickMe's card ROI
math both need.

Otherwise classify by coefficient of variation over the matched subsequence:

| CV | Pattern | Example |
|---|---|---|
| `< 0.02` | `FIXED` | Netflix 20.99 × n |
| `< 0.35` | `VARIABLE` | utility 82 / 105 / 94 |
| `≥ 0.35` | `USAGE_BASED` | Vercel 4 / 20 / 12 |

## 5. Confidence

Additive, clamped to `[0, 1]`. Every term is stored as
`{ code, delta, detail }` so the UI can explain itself.

| Code | Δ |
|---|---|
| `REGULAR_OCCURRENCES` (≥3) | +0.35 |
| `MANY_OCCURRENCES` (≥6) | +0.15 |
| `EXPLICIT_CADENCE` (email states it) | +0.20 |
| `EXPLICIT_RECURRING` (auto-renew / recurring) | +0.15 |
| `KNOWN_MERCHANT` (merchantPack, recurring category) | +0.10 |
| `FIXED_AMOUNT` | +0.10 |
| `CANCELLED_AFTER_LAST_CHARGE` | −0.40 |
| `THIN_EVIDENCE` (n=2, no explicit cadence) | −0.30 |
| `SHAKY_CADENCE` (MAD > tolerance/2) | −0.20 |

Renders as: *"5 Spotify charges, ~30 days apart (+0.35); Spotify is a known
subscription merchant (+0.10)."*

Confidence orders the review inbox. It never gates creation: every
obligation routes through review regardless of score (§1).

### These weights are initial, and must become measured

The table above is judgement, not evidence. But routing everything through
review generates the labels for free: a confirm is a true positive, a dismiss a
false positive, each already stamped with the confidence and reasons that
produced it. Capture the dismissal reason from the first phase and precision by
score bucket becomes computable, which is the difference between thresholds
that were picked and thresholds that were justified.

## 6. Lifecycle

A pure fold over time-ordered `ObligationFact[]`, producing a **derived**
status. Nothing is stored and mutated.

| Status | Condition |
|---|---|
| `TRIALING` | trial fact, no charge yet |
| `ACTIVE` | last charge within 1.5 × P |
| `CANCELLING` | cancellation fact with a future effective date |
| `CANCELLED` | cancellation fact with a past effective date |
| `LAPSED` | no charge in > 2 × P, no cancellation |

`LAPSED` is deliberately distinct from `CANCELLED`: we do not know the user
cancelled, only that charges stopped. Saying so is more useful than guessing.

"Explicit cancellation outweighs older recurrence evidence" needs no special
case — facts are time-ordered and later facts win.

### Timezone

`occurrencesBetween` operates on UTC date strings, but a charge at 23:30 in
`America/Toronto` is the next UTC day. Across many occurrences the median
absorbs the jitter; the inferred **anchor day** can still land one day off,
which is exactly the error a "due tomorrow" notification cannot afford. Infer
day-of-month in the user's profile timezone, not UTC. `WalletEvent.capturedTimezone`
shows the codebase already treats this as a real distinction.

Derived status is what makes the sweep idempotent. A stored status is a cache
of a computation over evidence, and like every cache it goes stale when the
evidence changes and nothing invalidates it: skip one nightly scan and a
mutated `CANCELLED` never learns the user resubscribed.

## 7. Schema

```prisma
model RecurringObligation {
  id                  String   @id @default(cuid())
  userId              String
  // Nullable on purpose. `kind` is only knowable from merchantPack.category
  // or from the user; a frequently-wrong kind is worse than an absent one, so
  // detection never guesses it.
  kind                ObligationKind?
  merchantCanonicalId String
  currency            String           // part of identity — see §4
  discriminator       String?          // account suffix / plan, from email only

  cadence             Json             // extended Cadence
  schedule            Json             // ScheduleEntry[] — the price history
  amountPattern       AmountPattern

  status              ObligationStatus // derived by lifecycle.ts each sweep
  nextExpectedDate    DateTime?
  confidence          Float
  confidenceReasons   Json             // Reason[]
  lastObservedAt      DateTime
  algorithmVersion    Int              // stale when < deployed version (§3)
  evidence            RecurringObligationEvidence[]

  origin              ObligationOrigin // DETECTED | USER | MIGRATED
  needsReview         Boolean  @default(false)

  // The payee-intelligence block moves verbatim from Bill (4be8270),
  // column for column, including the encrypted-at-rest account identifier
  // and its last-four/label companions. Listed in full in the migration,
  // not restated here — it must not drift from Bill's definition.
  // payee · accountNumber{,Encrypted,Last4,Label} · loginIdentifier
  // credentialLocation · serviceUrl · loginUrl · billingUrl · cancellationUrl
  // billerKind · paymentsCanadaCcin · billerVerified{At,Env} · autopay
  // paymentRail · railFeePct · selectedRoute{,Intermediary}Id · interestRatePct

  @@unique([userId, merchantCanonicalId, currency, discriminator])
  @@index([userId, status, nextExpectedDate])
  @@index([algorithmVersion])
}

/// The evidence behind an obligation, as links rather than a count.
///
/// An earlier draft carried `evidenceCount Int`, which was a denormalized
/// cache of a relation that was never modelled — and it quietly broke the
/// feature's whole premise. A count can render "5 charges, ~30 days apart"
/// but cannot show *which* five, cannot let a user exclude a charge that does
/// not belong, cannot re-derive one obligation without re-clustering
/// everything, and cannot be audited after a false positive.
///
/// It also supplies the merchant-alias merge story: when two aliases are
/// merged (a rebrand, or amazon.ca vs amazon.com), evidence is repointed and
/// the obligation re-derives, rather than obligation rows being hand-edited.
model RecurringObligationEvidence {
  obligationId       String
  purchaseId         String
  emailTransactionId String?
  role               EvidenceRole   // OCCURRENCE | CADENCE_FACT | CANCELLATION | TRIAL | PRICE_CHANGE
  excludedByUser     Boolean @default(false)
  obligation         RecurringObligation @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  @@unique([obligationId, purchaseId])
  @@index([purchaseId])
}

enum ObligationKind   { SUBSCRIPTION BILL LOAN INSURANCE MEMBERSHIP FEE }
enum AmountPattern    { FIXED VARIABLE USAGE_BASED }
enum ObligationStatus { TRIALING ACTIVE CANCELLING CANCELLED LAPSED }
enum ObligationOrigin { DETECTED USER MIGRATED }
enum EvidenceRole     { OCCURRENCE CADENCE_FACT CANCELLATION TRIAL PRICE_CHANGE }
```

`origin` matters: a user-created obligation must never be overwritten by a
sweep, exactly as `promotePurchase` already refuses to overwrite an
owner-decided `category`.

### Cadence extension

```ts
type Cadence =
  | { type: "WEEKLY";     anchor: string }        // new
  | { type: "BIWEEKLY";   anchor: string }
  | { type: "MONTHLY";    dayOfMonth: number; startsFrom?: string; activeMonths?: number[] }
  | { type: "QUARTERLY";  anchor: string }
  | { type: "SEMIANNUAL"; anchor: string }        // new
  | { type: "ANNUAL";     anchor: string }
```

`occurrencesBetween` already handles `QUARTERLY`/`ANNUAL` by month-stepping
with day clamping; `SEMIANNUAL` is `stepMonths = 6` on that same path.
`WEEKLY` is the biweekly path with a 7-day step.

## 8. Idempotency and deduplication

Three layers:

1. **Message identity** — `EmailTransaction @@unique([userId, provider, messageId])`,
   already present.
2. **Cross-mailbox identity** — NEW. See §9.
3. **Obligation identity** — `@@unique([userId, merchantCanonicalId, currency, discriminator])`.
   Stable, so re-running the sweep updates in place rather than duplicating.
4. **Evidence identity** — `RecurringObligationEvidence @@unique([obligationId, purchaseId])`,
   so a re-sweep re-links rather than accumulating duplicate evidence rows.

## 9. Multi-account

`EmailConnection.userId` is `@unique` today: one email account per user,
enforced by the schema. Multi-account splits an obligation's history across
inboxes, which suppresses detection — so this is a precision prerequisite, not
a convenience feature.

Changes:

- Drop `EmailConnection.userId @unique`; add `@@unique([userId, provider, emailAddress])`.
- Per-connection OAuth tokens, `lastScanAt`, `scanMode`, and backfill cursor.
- Add `EmailTransaction.connectionId`.
- Cluster on `(userId, merchant)`, never `(connectionId, merchant)`.

### The double-counting bug this introduces

`purchaseMerge.ts:71` states that match candidates come **only from other
sources**; same-source dedup relies entirely on
`Purchase @@unique([userId, sourceEmailId])`, where `sourceEmailId` is Gmail's
*per-mailbox* message id.

The same Netflix receipt delivered to two of the user's addresses therefore
receives two different Gmail ids → two `EmailTransaction` rows → two `Purchase`
rows, which `findMatchingPurchase` refuses to merge because they share a
source. The detector then sees **24 charges in 12 months and infers biweekly**,
doubling projected annual spend and feeding that to PickMe's card math.

Fix: dedup on the RFC822 `Message-ID` **header**, which is stable across
mailboxes, rather than the provider's id. `mailparser` already parses it.

Note the two ingestion paths already disagree about message identity: the IMAP
path uses `envelope.messageId` (the header), the Gmail path uses `m.id` (the
provider's). Add `EmailTransaction.rfc822MessageId` and dedup on
`(userId, rfc822MessageId)` when present, falling back to the provider id.

## 10. Backfill

Annual detection needs two occurrences ≥365 days apart. The scan defaults to
`days = 90` (`scan/route.ts:72`), which makes annual detection **structurally
impossible** — not unlikely, impossible — regardless of algorithm quality.
That silently kills domain renewals, annual card fees, insurance, annual SaaS
plans, and quarterly bills at the margin.

A one-time 24-month backfill runs per connection on the claim-based job queue:
paginated through `buildReceiptQuery`, resumable via a stored cursor, with no
500-message cap. Routine scans stay at 90 days.

It writes `EmailTransaction` and `Purchase` only. Detection is the separate
sweep, so a partially-completed backfill degrades recall rather than producing
wrong obligations.

### It cannot run as a single invocation

`listRecentRawGmailMessages` fetches **serially** — one `messages.get` per
message — at `format: "raw"`, which pulls the full MIME body and every
attachment. Cron routes cap at `maxDuration = 120`
(`src/app/api/cron/prices/route.ts:32`). At roughly 200 ms per round trip that
is about **600 messages per invocation**, against a 24-month target that can
exceed 5,000.

Required:

- **Chunk across invocations** via the existing claim pattern, with a stored
  cursor per connection. Bounded concurrency on `messages.get` (Gmail allows
  ~250 quota units/user/second; `messages.get` costs 5).
- **Two passes.** `format: "metadata"` first to build the recurrence skeleton
  cheaply — sender, subject, date are enough to cluster and infer cadence —
  then `raw` only for messages that classify as interesting.
- **No attachment persistence during backfill.** It exists to find cadence,
  not to archive receipts; writing `ReceiptDocument` for two years of history
  is object-storage cost with no bearing on detection.

### Consent

The backfill is **user-initiated and strongly prompted**, never silent on
connect. A prominent post-connect call to action ("Find my subscriptions —
we'll scan 2 years of receipts"), not a background job the user discovers
afterwards. This is both the correct privacy posture for a two-year inbox read
and better product: a multi-minute job needs a progress surface, and a user who
asked for it will wait for it.

## 11. Migration

Four independently deployable steps.

1. **Add + backfill.** Create `RecurringObligation`. Copy `Bill` losslessly
   (its `cadence`/`schedule` move as-is; `kind = BILL`). Map `Subscription`:
   `MONTHLY → {type:MONTHLY, dayOfMonth: renewalDate.getUTCDate()}`,
   `YEARLY → {type:ANNUAL, anchor: renewalDate}`,
   `CUSTOM → {type:MONTHLY, dayOfMonth: renewalDate.getUTCDate()}` **with
   `needsReview = true`**, so the row keeps its renewal date and disappears
   from nothing, and the first sweep over its purchase history corrects the
   cadence from evidence. `origin = MIGRATED` throughout.
   `schedule = [{ from: today, amountMinor: amountCents }]`.
2. **Dual-write.** Writes hit both; reads still come from `Bill`/`Subscription`.
   Add a check asserting the projections agree.
3. **Flip reads.** `Bill`/`Subscription` become read-through views. Rewire
   `scheduleBillDueSoon` / `scheduleSubscriptionRenewalSoon`, `DetectedItem`'s
   FK, `billforecast`, `dangermonth`, `calendarSources`, `cardForBill`.
4. **Drop.** Remove the old tables and `SubscriptionCadence`.

## 12. AI/LLM policy

**No LLM in the detection path, and not later either.**

Every ambiguous case here is ambiguous because *evidence is missing*, not
because language is hard. A single Vercel invoice is unclassifiable no matter
how capable the reader, because one occurrence cannot establish a cadence. An
LLM would produce a confident guess where the honest answer is "wait for the
second charge" — converting a recall gap into a precision failure, in a system
whose entire value proposition is an explainable "5 charges, ~30 days apart".

The costs are also real: nondeterminism defeats the re-runnable sweep (§3),
inbox contents are the most sensitive data we hold, and vendor latency would
sit inside a nightly job that must complete.

One place it is defensible, and it is not in this path: **merchant-pack
authoring** — an offline, batched, human-reviewed job proposing new
`merchant-pack.json` entries from unmatched sender domains. That table is
PickMe's, the output is reviewed before it ships, and no user data is at
inference time. Out of scope here.

## 13. Testing

Fixtures are **purchase sequences**, not emails — the point of the substrate
choice. Each is a table of `(date, amountMinor)` plus optional email facts.

Recall cases: `netflix-monthly` · `domain-annual` · `utility-variable` ·
`subscription-cancellation` · `trial-conversion` · `price-increase` ·
`annual-card-fee` · `biweekly-mortgage` · `quarterly-water` ·
`merchant-alias-drift` · `seasonal-gas-oct-to-apr`.

Precision cases matter more, and assert **non**-detection:
`amazon-noise` (40 irregular orders → nothing) ·
`two-coincidental-charges` (n=2, no explicit cadence → nothing) ·
`marketing-email-only` (no spine evidence → nothing).

The decisive one is `amazon-prime-buried-in-noise`: the same merchant must
yield exactly one obligation and leave the forty orders alone.

Identity regressions (§2 defect 4), which are false-merge tests:
`uk-merchants-do-not-collapse` — receipts from `shopify.co.uk`,
`britishgas.co.uk`, and `netflix.co.uk` must yield three merchants, never one
`co.uk` obligation · `subdomain-drift` — `noreply@email.netflix.com` and
`info@netflix.com` must resolve to one merchant · `pack-beats-heuristic` — a
`merchantPack` `emailDomains` entry must win over the registrable-domain
fallback.

Integration: `duplicate-receipt-two-inboxes` must produce one obligation at
monthly, not one at biweekly (§9).

### Property-based tests

Thirteen hand-written fixtures cannot cover a numeric algorithm's failure
modes. Alongside them, with `fast-check`:

- For any generated sequence with period `P` and jitter within tolerance,
  inference returns `P`.
- For any Poisson-random sequence, inference returns `null`. **This is the
  precision guarantee**, and it is the one worth the most.
- For any sequence, `nextExpectedDate` is strictly after `lastObservedAt`.
- Inference is invariant to a whole-sequence date shift, and to the order rows
  arrive in.

## 14. Phases

- **P0 — Fabrication fixes + merchant identity.** Delete `+30d`,
  `dueDayOfMonth + 7`, and the `RENEWAL` fall-through. Replace the two-label
  suffix slice with registrable domain (`tldts`) behind a `merchantPack`
  `emailDomains` lookup (§2 defect 4). Identity is a prerequisite for
  everything downstream and independently improves purchase merging and
  categorization today, with no new model and no schema change. Ships alone.
- **P1 — Cadence extension.** `WEEKLY` + `SEMIANNUAL` in `src/engine/recurrence.ts`;
  publish through `contracts/` so PickMe generates its enum.

Then two parallel tracks, meeting at P6:

| Track A (data) | Track B (pure logic) |
|---|---|
| **P2** Multi-account + RFC822 dedup | **P4** Detection modules against fixtures — no DB, no schema |
| **P3** 24-month backfill job | **P5** `RecurringObligation` schema + migration steps 1–2 |

- **P6 — Sweep + review inbox.** Wire detection to the spine and to
  `/settings/automation/review`. Migration steps 3–4.
- **P7 — PickMe contract.** Emit observed obligations so `RecurringPlan` stops
  being hand-typed.

## 15. Deferred decisions

Open questions deliberately not settled here. **Agents: these are open, not
omitted — do not resolve them silently in an implementation.** Raise them with
the owner when the review date passes or when the work touches them.

### D1 — Retention of email-derived data · review by 2026-12-01

A 24-month inbox-derived financial history is a serious data holding under
PIPEDA, and this design creates it. `DataDeletionJob` and
`src/lib/security/` provide the machinery; what is missing is the **policy**.

The question: once an obligation is established, is the underlying
`EmailTransaction` corpus kept indefinitely, or pruned to the derived facts
plus the evidence links in `RecurringObligationEvidence`?

The tension is real in both directions. Pruning is better privacy and cheaper
storage, and the evidence links preserve explainability. But it forecloses
re-derivation: a future algorithm improvement (§3, `algorithmVersion`) can only
re-run over data still held, so pruning caps how much a later, better detector
can recover — the exact property that mechanism exists to provide.

Deferred because the answer depends on facts not yet in evidence: real corpus
size per user, and whether re-derivation actually earns its keep in practice.
Revisit once the backfill has run against real inboxes.

## 16. Non-goals

- No changes to `return-saas` (B1).
- No card-rule semantics. PickMe owns those, frozen (B6). We emit observations;
  PickMe decides what to do about them, including `RecurringFlagStatus`.
- No bank aggregation. Detection reads what we already observe.
- No auto-creation of obligations. Everything routes through review.
- No LLM (§12).
- No retention policy — deliberately deferred (§15, D1).
