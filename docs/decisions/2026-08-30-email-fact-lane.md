# Email lifecycle facts are extracted at ingestion and persisted

**Status:** Ratified 2026-08-30

## Decision

Financial facts an email *states* — a cancellation, a trial boundary, a price
change, a stated next billing date, an explicit cadence — are extracted where
the decoded body is in hand, at ingestion, and persisted as
`EmailObligationFact` rows. The recurring sweep reads those rows instead of
re-deriving them.

Neither FinnLens (`sureshdsk/finn-lens`) nor Subflo (`huzaifa525/subflo`)
contributes code to this repo. Both were evaluated against their source, not
their READMEs, and neither clears the bar. See "FinnLens and Subflo" below.

## Reason

`extractEmailSignals` is a capable extractor of exactly these facts, and it has
been running against almost nothing. Three losses compound:

1. **No body at sweep time.** `detectRecurring.ts` defines its `SweepEmail`
   input as `{ id, merchant, subject, purchasedAt, createdAt }`. Cancellation,
   trial, price-change, next-billing-date and cadence detection therefore all
   run against the subject line alone — while `parsedPurchase.textBody` was
   fully available during the scan that created the row.
2. **No payload persisted.** `RecurringObligationEvidence` stores
   `(role, occurredAt, emailTransactionId)`. The fact's payload — a price
   change's amount, a trial's end date, a stated billing date — is discarded
   and recomputed from nothing on every sweep.
3. **No home for a pre-obligation fact.** Evidence is obligation-scoped. A
   trial-ending notice that arrives before any charge has formed a cluster has
   nowhere to land at all.

None of this is an architecture problem. The extractor, the fact union
(`ObligationFact`), the lifecycle fold, the confidence model and the evidence
links are all already correct. What is missing is a place to put a fact between
the moment it is readable and the moment an obligation exists to cite it.

## FinnLens and Subflo

**FinnLens: cited as prior art, no code taken.** MIT-licensed
(© 2026 Suresh Kumar), so reuse would be permitted; nothing is worth reusing.
Every extraction value in it is India-specific — `currency: str = "INR"` as a
dataclass default, a currency symbol class of `₹|&#8377;|Rs\.?|INR`, issuer
inference over ICICI, HDFC, Axis, SBI and Kotak. Porting the statement
extractor means deleting every pattern in it and keeping four field names.

Its parser registry is also the wrong shape for this problem. `parse_email`
returns on the first parser whose `can_parse(sender, subject)` is true, with
`# Register parsers — order matters` as the ordering contract. That is
classification: one email, one type. A lifecycle email legitimately states a
price change *and* a next billing date *and* a cadence, and `extractEmailSignals`
already returns all three. Adopting first-match-wins would be a regression, and
a scored variant of it inherits the same defect with a tuning surface added.

The one asset FinnLens genuinely has is a corpus of real issuer mail, which is
what makes its regexes correct. This repo is public and holds no personal data,
so that asset cannot be reproduced here. That is the honest reason credit-card
statement extraction is deferred rather than scheduled.

**Subflo: cited as prior art, no code taken.** Its README declares MIT; there is
no `LICENSE` file and no named copyright holder. The question is moot because
nothing survives comparison:

- `payment-filter.ts` scores senders and subjects 0–100 with string signal
  labels. `recurring/confidence.ts` already does this with typed
  `ConfidenceReasonCode` values, one frozen weights table and a display-ready
  `detail` per reason. Ours is the stronger model.
- `service-mapper.ts` and `cancel-links.ts` duplicate `contracts/merchant-pack.json`,
  `Bill.cancellationUrl`, `Subscription.cancelUrl` and `Subscription.cancelInstructions`,
  and are weighted to Indian services.
- Its extraction is LLM-first over the leading few thousand characters of the
  body, which is the posture this repo exists to avoid.

Its payment-processor sender list overlaps the conduits worth adding, but a
third of it is India-only and the useful remainder is short enough to establish
firsthand. The list added here is written from scratch and Canada-weighted.

**Recorded so this is not re-litigated:** the valuable output of the evaluation
was the audit of this repo's own pipeline. Neither external repo prompted the
three losses above, and neither has the problem, because neither has a recurring
engine good enough to starve.

## The fact lane

Extraction runs inside `processRawGmailMessage`, which is the single choke point
for all three ingestion paths — the automation scan, the Gmail backfill, and
owner-triggered reprocessing. Facts therefore backfill through the existing
`/api/automation/reprocess` route, which already re-fetches raw messages in
bounded batches, with no new job.

The transaction lane is unchanged. `hasPurchaseEvidence` still decides whether
money moved, and still refuses a prospective charge. The fact lane runs beside
it and asserts nothing about money moving.

```
scan / backfill / reprocess
  └─ parsePurchaseFromRawGmailMessage        textBody available here
       ├─ transaction lane   hasPurchaseEvidence  → Purchase
       └─ fact lane          runFactExtractors    → EmailObligationFact
recurring sweep
  └─ reads facts by merchant; no re-derivation
       └─ RecurringObligationEvidence.emailFactId → the fact row
```

### Model

`EmailObligationFact`, not the wider `FinancialEmailObservation` that was
proposed. The type maps one-to-one onto the `ObligationFact` union already in
`recurring/types.ts`: this is persistence for a type that exists, not a new
abstraction. The narrow name leaves `EmailStatementFact` available later without
a rename.

Fields: `userId`, `emailTransactionId`, `type`, `extractorId`,
`extractorVersion`, `factKey`, `occurredAt`, `effectiveAt?`, `billingAt?`,
`amountMinor?`, `currency?`, `cadence?`, `evidenceSnippet`.

Resolved details, each with its reason:

- **No `merchantCanonicalId` column.** Merchant identity joins through
  `EmailTransaction.merchant`, which is indexed. `Purchase.normalizationVersion`
  exists precisely because that identity gets corrected; a second copy would go
  stale and need a backfill on every normalization bump.
- **`factKey String @default("")`,** part of the unique key
  `(emailTransactionId, extractorId, type, factKey)`. One email routinely states
  several facts of one type: an Apple or Google Play receipt lists multiple
  subscriptions with separate renewal dates, and both are conduits this repo
  intends to support. A key on type alone would silently keep one and drop the
  rest. The empty default and the escape-hatch shape follow
  `RecurringObligation.seriesKey` and `discriminator`.
- **Per-extractor `extractorVersion`,** not one global number. A global version
  forces full re-extraction whenever any single pattern changes; per-extractor
  versions let one extractor be re-run and measured in isolation.
- **Facts are immutable and upserted idempotently.** Reprocessing rewrites a
  message's facts in place. A row's `extractorVersion` records which build wrote
  it, so backfill progress is queryable rather than assumed.
- **`onDelete: Cascade` on both `user` and `emailTransaction`.** `/api/data/delete`
  performs `prisma.user.delete` and relies wholly on cascade; a table without it
  fails account deletion with a foreign-key error whose only signal is a failed
  `DataDeletionJob`.
- **Included in `/api/data/export`,** snippet and all. Export goes to the owner
  and the content is their own mail. The `Bill.accountNumberEncrypted` omission
  is about not exporting ciphertext and does not generalize.
- **Extractors live in `src/lib/domain/receipts/`.** They read parsed Gmail
  messages, which is what that directory already is. A new `domain/email/`
  holding one concern would be structure ahead of need.

### Evidence snippets

Each fact stores the matched window that produced it: 200 characters centred on
the match, whitespace collapsed, URLs stripped. Two hundred characters is enough
to answer "why did you tell me my price is changing" with the merchant's own
words. URLs are removed because tracking pixels and unsubscribe links carry
per-recipient identifiers, and are the one part of a body that is actively
rather than incidentally identifying.

Snippets are stored in plaintext. There is no shared crypto module in this repo,
and the snippet is strictly less sensitive than the `subject`, `merchant` and
`totalCents` already stored in cleartext on the same row. Encrypting one and not
the others would be theatre. If encryption at rest becomes the standard it is a
schema-wide decision, taken deliberately, not introduced through this table.

Full email bodies are never persisted. `/api/automation/reprocess` re-fetches raw
messages from Gmail on demand, so the mailbox remains the body store and this
repo keeps only derived facts and the quotes that justify them.

### Extractor shape

`extractEmailSignals` splits into one pure function per fact type, all of which
run, with results unioned — the semantics it already has. There is no dispatch,
no ordering and no scoring. Each extractor carries its own id, its own version
and its own tests.

The fact lane runs on every scanned message, ungated. `buildReceiptQuery`
already excludes the promotions and social categories and requires either
`category:purchases` or explicit receipt wording, and the extractors carry their
own `OBLIGATION_CONTEXT` gate. A third gate would only add a place for a fact to
die silently.

### Email-stated obligations

A merchant writing that a plan renews monthly at a stated price on a stated date
is explicit evidence, not weak evidence. Withholding it would misread the
governing principle, which forbids converting *weak* evidence into financial
facts, not explicit statements.

`ObligationOrigin` gains `EMAIL_STATED`. `hasSufficientRecurringEvidence` admits
zero occurrences only with `EXPLICIT_CADENCE` and either a stated amount or a
`NEXT_BILLING_DATE`. Such a series is always `needsReview`.

No confidence cap is written, because the existing weights already impose one.
An email-only series has no occurrences, so `REGULAR_OCCURRENCES` (0.35) and
`MANY_OCCURRENCES` (0.15) cannot fire; its ceiling is `EXPLICIT_CADENCE` +
`EXPLICIT_RECURRING` + `KNOWN_MERCHANT` = 0.45, structurally below any
charge-backed series. A hand-written cap would be a second, drifting statement
of a rule the weights already express.

### Boundaries

The fact lane feeds `RecurringObligation` only. `Subscription` is a separate,
earlier surface behind `/api/subscriptions` with no cadence inference, amount
patterns, confidence or evidence links. Feeding both would build the parallel
subscription engine this repo's review standards forbid. The overlap between the
two models is acknowledged debt and is not addressed here; until it is resolved
the two surfaces may disagree, and `/api/recurring` is the accurate one.

`classifyReceiptEmail` stays. It answers a different question — is this
receipt-shaped at all — and gates the purchase lane.

## LLM role

None, for now. Deterministic extraction only.

The placement is nonetheless decided in advance, so that reaching for a model
later is not a fresh argument. When deterministic extractors return no facts for
a message from a known billing conduit, a model may return **verbatim spans**
from the body and nothing else — never parsed values. Each span is discarded
unless it literally occurs in the body; survivors are passed to the same
deterministic extractors. Provenance stays a real quote, interpretation stays
deterministic, and a hallucinated span fails the substring check before it can
reach the domain.

This is not built now because there is no measured miss rate to justify it.
Build it when misses are visible in the data, not before.

## Deferred: credit-card statement extraction

Extracting statement balance, minimum payment, statement period and PDF line
items from issuer mail is deferred, not rejected. It is blocked on a real
constraint rather than on priority: issuer templates cannot be developed or
regression-tested against fictional fixtures, and this repo is public and admits
no personal data.

It unblocks when either a private fixture corpus exists outside this repository,
or a runtime-only capture path exists that never enters git. Until then,
`StatementLine` continues to be written solely by the manual reconcile flow.

## Order of work

1. **`EmailObligationFact` and extraction at ingestion.** Migration, extraction
   inside `processRawGmailMessage`, snippet capture. Fixes losses 1 and 2.
2. **Sweep reads facts.** `RecurringObligationEvidence.emailFactId`; remove
   subject-only re-derivation from `detectRecurring`. Fixes loss 3's read side.
3. **Conduits.** Stripe, Apple, Google Play and Microsoft billing added to
   `CONDUITS` in `emailMerchant.ts`, each with its own `extractPayee`.
4. **Per-fact extractor split,** with per-extractor ids and versions.
5. **`EMAIL_STATED` origin** and the `hasSufficientRecurringEvidence` gate.
6. **Retire `detectSubscriptionItem`;** derive `DetectedItem` from facts. Kept
   separate because it changes rows the owner may already have acted on.

Steps 1 and 2 are the correction. Everything after is capability, and should not
be bundled with it.
