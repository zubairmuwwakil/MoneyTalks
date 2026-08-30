# Making Recurring Detection Visible (P6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the detection engine — which already works, and finds real obligations in a real inbox — into something the owner can see and confirm.

**Architecture:** `RecurringObligation` and `RecurringObligationEvidence` land as **new, additive** tables. A nightly sweep clusters the `Purchase` spine, folds in email-derived facts, scores confidence, and upserts obligations keyed on identity. Detected obligations surface in the existing review inbox. **Nothing about `Bill` or `Subscription` changes in this phase.**

**Tech Stack:** Next.js App Router (`runtime = "nodejs"`), Prisma 7 + Postgres, the pure modules in `src/lib/domain/recurring/`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-recurring-obligations-design.md` — §3 (Architecture), §5 (Confidence), §6 (Lifecycle), §7 (Schema).

## Deviation from the spec, deliberate

The spec's §14 spreads a `Bill` + `Subscription` collapse across P5 and P6. **This plan does not do that collapse**, and the spec's §7 should be read as the eventual target rather than this phase's scope.

Reason: `Bill` has 13 readers and `Subscription` has 11, across forecasting, the calendar, `cardForBill`, notifications, snapshots and the write-off flow. Restructuring both while simultaneously wiring up detection makes one large change where two small ones will do, and puts a shippable feature behind the riskiest data migration in the project. Detection needs a table, a sweep, and a surface — none of which require touching either model.

So: obligations are written to their own table, confirming a suggestion keeps creating a `Bill` or `Subscription` exactly as it does today, and the collapse becomes its own later phase with nothing blocked behind it. The duplication is real and temporary, and it is cheaper than the alternative.

## Global Constraints

- **Nothing auto-creates.** Every detected obligation routes through the review inbox regardless of confidence. Precision failures must cost a click, never trust.
- **Status is derived, never a mutable column.** `lifecycle.ts` folds facts each sweep. A stored status is a cache that goes stale the moment a scan is missed.
- **The sweep is re-runnable and must be idempotent.** Obligation identity is `(userId, canonicalMerchantId, currency, discriminator)`; a re-run updates in place.
- **Never overwrite an owner's decision.** `origin = USER` rows and evidence rows with `excludedByUser` are read-only to the sweep, the same discipline `promotePurchase` already applies to a hand-set `category`.
- Sweeps run on the claim-based job queue (`claimDueDigestJobs`), never in a request handler. Cron routes cap at `maxDuration = 120`.
- `npm run check` must pass at every commit. Baseline: 156 files / 1383 tests.
- Migrations are `prisma/migrations/<YYYYMMDDHHMMSS>_<snake_name>/migration.sql`.

---

### Task 1: The obligation tables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260829180000_recurring_obligations/migration.sql`

**Interfaces:**
- Produces: `RecurringObligation` and `RecurringObligationEvidence` models, and enums `AmountPatternKind`, `ObligationLifecycleStatus`, `ObligationOrigin`, `EvidenceRole`.

Purely additive. No existing table is altered, so this migration cannot break a reader.

- [ ] **Step 1: Add the models**

```prisma
model RecurringObligation {
  id                  String   @id @default(cuid())
  userId              String
  // Nullable on purpose: kind is only knowable from merchantPack.category or
  // from the owner. A frequently-wrong kind is worse than an absent one, so
  // detection never guesses it.
  kind                String?
  merchantCanonicalId String
  currency            String
  discriminator       String?

  cadence             Json     // engine Cadence (src/engine/recurrence.ts)
  schedule            Json     // ScheduleEntry[] — the price history
  amountPattern       AmountPatternKind
  status              ObligationLifecycleStatus
  nextExpectedDate    DateTime?

  confidence          Float
  confidenceReasons   Json     // Reason[] from confidence.ts
  lastObservedAt      DateTime
  // Stale when below the deployed version, so a tuning change re-derives as a
  // rolling backfill rather than a data migration.
  algorithmVersion    Int      @default(1)

  origin              ObligationOrigin @default(DETECTED)
  needsReview         Boolean  @default(true)
  dismissedAt         DateTime?
  confirmedAt         DateTime?
  // Why the owner rejected it. P8 (spec §15) cannot distinguish a false
  // positive from a duplicate, or from a merchant the owner does not care
  // about, without this — and those imply opposite fixes.
  dismissReason       String?
  // The score AT THE MOMENT the owner decided. `confidence` above is
  // overwritten by every sweep, so without a snapshot a row confirmed at 0.55
  // and re-scored to 0.80 would read back as evidence that 0.80 is reliable.
  decidedConfidence   Float?
  decidedReasons      Json?

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  evidence            RecurringObligationEvidence[]

  @@unique([userId, merchantCanonicalId, currency, discriminator])
  @@index([userId, status, nextExpectedDate])
  @@index([algorithmVersion])
}

/// Evidence as links, not a count.
///
/// A count can render "5 charges, ~30 days apart" but cannot show WHICH five,
/// cannot let an owner exclude a charge that does not belong, cannot re-derive
/// one obligation without re-clustering everything, and cannot be audited
/// after a false positive. Explainability is the feature; a bare integer does
/// not support it.
model RecurringObligationEvidence {
  id                 String   @id @default(cuid())
  obligationId       String
  purchaseId         String?
  emailTransactionId String?
  role               EvidenceRole
  excludedByUser     Boolean  @default(false)
  occurredAt         DateTime

  obligation         RecurringObligation @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  @@unique([obligationId, purchaseId])
  @@index([obligationId, occurredAt])
  @@index([purchaseId])
}

enum AmountPatternKind         { FIXED VARIABLE USAGE_BASED UNKNOWN }
enum ObligationLifecycleStatus { TRIALING ACTIVE CANCELLING CANCELLED LAPSED }
enum ObligationOrigin          { DETECTED USER MIGRATED }
enum EvidenceRole              { OCCURRENCE CADENCE_FACT CANCELLATION TRIAL PRICE_CHANGE }
```

Add `recurringObligations RecurringObligation[]` to `model User`.

`@@unique([obligationId, purchaseId])` with a nullable `purchaseId`: Postgres treats NULLs as distinct, so this constrains purchase-backed evidence and lets many email-only facts attach. That is the intent — a cancellation email has no purchase.

`AmountPatternKind` mirrors the `AmountPattern` union in `src/lib/domain/recurring/types.ts`. Keep the members identical; a drift between them is a runtime cast failure.

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name recurring_obligations --create-only`
Then read the generated SQL and confirm it only CREATEs. If it ALTERs or DROPs anything on an existing table, stop — something else is uncommitted in the schema.

- [ ] **Step 3: Verify**

Run: `npx prisma generate && npx tsc --noEmit && npm run check`
Expected: clean. Additive tables break no reader.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260829180000_recurring_obligations
git commit -m "feat(recurring): add obligation and evidence tables"
```

---

### Task 2: The sweep

**Files:**
- Create: `src/lib/domain/recurring/detectRecurring.ts`
- Test: `src/lib/domain/recurring/detectRecurring.test.ts`

**Interfaces:**
- Consumes: `clusterRecurringPurchases`, `inferCadence`, `inferAmountPattern`, `scoreConfidence` (`confidence.ts`), `deriveStatus` (`lifecycle.ts`), `extractEmailFacts` (`emailSignals.ts`). **Read each module's actual exported signature before writing — do not assume these names.**
- Produces: `sweepRecurringObligations(db, { userId, timeZone, algorithmVersion })` returning `{ created, updated, unchanged, skipped }`.

This is the only impure module in `src/lib/domain/recurring/`. Everything it calls is already written and tested; its job is orchestration and persistence, not new logic.

- [ ] **Step 1: Write the failing test**

```ts
it("creates an obligation from a regular purchase series", async () => {
  await seedPurchases("netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2099);

  const result = await sweepRecurringObligations(db, { userId: "user-1", timeZone: "America/Toronto", algorithmVersion: 1 });

  expect(result.created).toBe(1);
  const [obligation] = await db.recurringObligation.findMany();
  expect(obligation.status).toBe("ACTIVE");
  expect(obligation.needsReview).toBe(true);
  expect(await db.recurringObligationEvidence.count({ where: { obligationId: obligation.id } })).toBe(3);
});

it("is idempotent — a second sweep updates rather than duplicating", async () => {
  await seedPurchases("netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2099);
  await sweepRecurringObligations(db, sweepArgs);
  const second = await sweepRecurringObligations(db, sweepArgs);

  expect(second.created).toBe(0);
  expect(await db.recurringObligation.count()).toBe(1);
  expect(await db.recurringObligationEvidence.count()).toBe(3);
});

it("never overwrites an owner-created obligation", async () => {
  await db.recurringObligation.create({ data: ownerObligation("netflix.com", { origin: "USER", confidence: 1 }) });
  await seedPurchases("netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 999);

  await sweepRecurringObligations(db, sweepArgs);

  const [obligation] = await db.recurringObligation.findMany();
  expect(obligation.origin).toBe("USER");
  expect(obligation.confidence).toBe(1);
});

it("ignores evidence the owner excluded", async () => {
  // An owner who says "that charge is not part of this" must not have it
  // re-attached by the next sweep, or the correction is meaningless.
  const obligation = await seedDetectedObligation("netflix.com");
  await excludeEvidence(obligation.id, { at: "2026-06-11" });

  await sweepRecurringObligations(db, sweepArgs);

  const evidence = await db.recurringObligationEvidence.findMany({ where: { obligationId: obligation.id } });
  expect(evidence.find((e) => isoDate(e.occurredAt) === "2026-06-11")?.excludedByUser).toBe(true);
});

it("derives CANCELLED from a cancellation email after the last charge", async () => {
  await seedPurchases("23andme.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 1499);
  await seedEmail("23andme.com", "2026-07-20", "You canceled 23andMe+ Premium");

  await sweepRecurringObligations(db, sweepArgs);

  const [obligation] = await db.recurringObligation.findMany();
  expect(obligation.status).toBe("CANCELLED");
  expect(obligation.confidence).toBeLessThan(0.5);
});

it("re-derives a row whose algorithmVersion is behind", async () => {
  await seedPurchases("netflix.com", ["2026-05-11", "2026-06-11", "2026-07-11"], 2099);
  await sweepRecurringObligations(db, { ...sweepArgs, algorithmVersion: 1 });

  const result = await sweepRecurringObligations(db, { ...sweepArgs, algorithmVersion: 2 });

  expect(result.updated).toBe(1);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/domain/recurring/detectRecurring.test.ts`
Expected: FAIL — `sweepRecurringObligations` is not exported.

- [ ] **Step 3: Implement**

Order of work inside the sweep:

1. Load the owner's `Purchase` rows, mapped to `ClusteringPurchase` — `canonicalMerchantId` from `Purchase.merchant` (identity is already resolved upstream by `resolveEmailMerchant`; **do not re-resolve it here**), `amountMinor` from `totalCents` (nullable — an unpriced series is valid), `currency` defaulted per the owner's profile only when absent.
2. `clusterRecurringPurchases(...)` with the owner's timezone.
3. For each cluster: gather `EmailTransaction` rows for that merchant, run `extractEmailFacts`, add a `CHARGE` fact per clustered purchase, `deriveStatus(...)`, `scoreConfidence(...)`.
4. Upsert on `@@unique([userId, merchantCanonicalId, currency, discriminator])`. **Skip entirely when the existing row has `origin: "USER"`.**
5. Replace evidence links for that obligation, preserving any row with `excludedByUser: true` and excluding those purchases from the cluster on the next pass.
6. `nextExpectedDate` from `occurrencesBetween(cadence, today, +90d)[0]` — reuse the engine, write no new projection.
7. Set `algorithmVersion` to the deployed value.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/domain/recurring/`
Expected: PASS, existing 41 included.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/recurring/detectRecurring.ts src/lib/domain/recurring/detectRecurring.test.ts
git commit -m "feat(recurring): sweep the purchase spine into obligations"
```

---

### Task 3: Schedule the sweep

**Files:**
- Create: `src/app/api/cron/recurring-sweep/route.ts`
- Test: `src/app/api/cron/recurring-sweep/route.test.ts`
- Modify: `scripts/ops/qstash-schedules.config.mjs`

**Interfaces:**
- Consumes: Task 2's `sweepRecurringObligations`.
- Produces: an authenticated cron route sweeping owners in bounded batches.

- [ ] **Step 1: Read the existing cron conventions**

Read `src/app/api/cron/purchase-merge/route.ts` in full. Copy its authentication, its batching, and its response shape. Read `scripts/ops/qstash-schedules.config.mjs` and its test — **schedule ids are frozen**, because renaming one creates a second schedule and orphans the first. Adding one is fine; renaming is not.

Note: `.claude/skills/cron-schedule-change` covers changes to scheduled jobs in this repo. Follow it.

- [ ] **Step 2: Write the failing test**

```ts
it("rejects an unauthenticated request", async () => {
  const response = await GET(new Request("http://localhost/api/cron/recurring-sweep"));
  expect(response.status).toBe(401);
});

it("sweeps each owner and keeps going when one fails", async () => {
  vi.mocked(sweepRecurringObligations).mockRejectedValueOnce(new Error("boom"));
  const response = await GET(authedRequest());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.swept).toBe(1);
  expect(body.failed).toBe(1);
});
```

- [ ] **Step 3: Implement**

`export const runtime = "nodejs"` and `export const maxDuration = 120`. Bound the batch so the route cannot exceed it — sweep owners with purchase activity since their last sweep, or whose obligations are behind `algorithmVersion`, capped per invocation. One owner's failure is caught and counted, never fatal.

- [ ] **Step 4: Run the tests, then `npm run check`**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/recurring-sweep scripts/ops/qstash-schedules.config.mjs
git commit -m "feat(cron): sweep recurring obligations nightly"
```

---

### Task 4: Show them in the review inbox

**Files:**
- Create: `src/app/api/recurring/route.ts`, `src/app/api/recurring/[id]/route.ts`
- Modify: `src/app/automation/ui/DetectedInbox.tsx` (or a sibling component), `src/app/settings/automation/review/page.tsx`
- Test: `src/app/api/recurring/route.test.ts`

**Interfaces:**
- Consumes: Task 1's tables.
- Produces: `GET /api/recurring` listing obligations with evidence; `PATCH /api/recurring/[id]` accepting `{ action: "confirm" | "dismiss" | "exclude-evidence", dismissReason?, evidenceId? }`.

**Phase P8 (Measurement, spec §15) depends on this task and cannot be
retrofitted.** Its labels are generated as the owner clicks: a confirm is a
true positive, a dismiss a false positive, each meaningful only alongside the
`confidence` and `confidenceReasons` that produced it. Two consequences bind
this task:

1. **Capture a dismissal reason.** Without one, P8 cannot tell a false
   positive ("this is not recurring") from a duplicate, or from a merchant the
   owner simply does not care about. Those demand opposite responses — the
   first means retune the weights, the second means nothing is wrong. Offer a
   short fixed set plus free text; store it on the obligation.
2. **Snapshot the score at decision time.** `confidence` and
   `confidenceReasons` are overwritten by every sweep, so a row confirmed at
   0.55 and later re-scored to 0.80 would be read back as evidence that 0.80
   is reliable. Copy both onto the decision record when the owner acts.

Every obligation dismissed before this lands is a label lost permanently,
which is why it belongs here rather than in P8.

- [ ] **Step 1: Write the failing test**

```ts
it("lists detected obligations with their evidence and reasons", async () => {
  const body = await (await GET(authedRequest())).json();
  expect(body.obligations[0]).toMatchObject({
    merchantCanonicalId: "netflix.com",
    status: "ACTIVE",
    confidence: expect.any(Number),
  });
  expect(body.obligations[0].reasons[0]).toHaveProperty("detail");
  expect(body.obligations[0].evidence).toHaveLength(3);
});

it("scopes to the requesting owner", async () => {
  await seedObligation({ userId: "someone-else" });
  const body = await (await GET(authedRequest())).json();
  expect(body.obligations.every((o) => o.userId === "user-1")).toBe(true);
});

it("dismissing sets dismissedAt and clears needsReview", async () => {
  await PATCH(authedRequest({ action: "dismiss", dismissReason: "not-recurring" }), { params: { id } });
  const obligation = await db.recurringObligation.findUnique({ where: { id } });
  expect(obligation?.dismissedAt).toBeInstanceOf(Date);
  expect(obligation?.needsReview).toBe(false);
  expect(obligation?.dismissReason).toBe("not-recurring");
});

it("snapshots the score that produced the decision", async () => {
  // A later sweep overwrites confidence. Without a snapshot, a row confirmed
  // at 0.55 and re-scored to 0.80 reads back as evidence that 0.80 is
  // reliable — which would corrupt P8's precision curve in the flattering
  // direction.
  await PATCH(authedRequest({ action: "confirm" }), { params: { id } });
  const before = await db.recurringObligation.findUnique({ where: { id } });

  await sweepRecurringObligations(db, sweepArgs);

  const after = await db.recurringObligation.findUnique({ where: { id } });
  expect(after?.decidedConfidence).toBe(before?.decidedConfidence);
  expect(after?.decidedReasons).toEqual(before?.decidedReasons);
});
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement**

Scope every query by `userId` — that is the authorization check, not a filter. The UI renders per obligation: merchant, cadence in words, amount or "amount not stated", status, `nextExpectedDate`, and **the confidence reasons as a sentence** — "5 charges from Spotify, roughly 30 days apart" — which is the whole point of storing them. List the evidence dates so an owner can exclude one.

Follow the existing card layout in `InboxReview.tsx`. Do **not** render raw JSON; that file's `JSON.stringify` block is a known rough edge, not a pattern to copy.

- [ ] **Step 4: Run the tests, then `npm run check`**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/recurring src/app/automation/ui src/app/settings/automation/review
git commit -m "feat(automation): review detected recurring obligations"
```

---

### Task 5: Prove it end to end

**Files:**
- Create: `scripts/ops/sweepRecurringForOwner.ts`

**Interfaces:**
- Consumes: Task 2's sweep.

- [ ] **Step 1: Write the script**

Follow `scripts/ops/reconcileMerchantIdentity.ts` for conventions: dotenv, `PrismaPg` (Prisma 7 rejects a bare `new PrismaClient()`), dry run by default, `--apply` to write, corpus totals so a zero result is unambiguous.

- [ ] **Step 2: Dry-run it against production and report**

Expect Anthropic and Heroku at minimum — both were confirmed detectable from the live spine on 2026-08-29 (`MONTHLY`, `USAGE_BASED`, coverage 1.00). Report anything else it finds, and anything it misses that looks obviously recurring.

Note `vercel.com` specifically: 9 purchases, monthly series rejected at a 3-of-9 share. If the reprocess dedup has since collapsed its same-day rows, Vercel should now appear — that is a live prediction worth checking, and reporting either way.

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/sweepRecurringForOwner.ts
git commit -m "feat(ops): sweep one owner's obligations from the command line"
```

---

## Out of scope

- **The `Bill` + `Subscription` collapse.** Its own later phase; see the deviation note above. Nothing here touches either model, and confirming a suggestion keeps creating them as it does today.
- Phase P3's 24-month backfill. `EmailConnection.backfillCursor` and `backfillCompletedAt` exist; nothing here writes them.
- Phase P7's PickMe contract. `scripts/sync/sync-contracts.sh` runs PickMe → hub only; the reverse direction is new infrastructure.
- Auto-creating obligations. Every one routes through review.
- Phase P8's reporting itself (precision by score bucket, per-signal
  contribution, the stated target). This plan only ensures the labels P8 needs
  are captured as they are generated — see Task 4.
