# 24-Month Gmail Backfill (P3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give recurrence detection enough history to see annual obligations, which a 90-day window makes mathematically impossible to detect.

**Architecture:** A resumable, owner-initiated backfill that walks a connection's mail **backwards in time** in month-sized windows, driven from a cron route with the `EmailConnection` row itself as the job record. No new job table: `backfillRequestedAt`, `backfillCursor` and `backfillCompletedAt` are the whole state machine.

**Tech Stack:** Next.js App Router (`runtime = "nodejs"`, `maxDuration = 120`), Prisma 7 + Postgres, `googleapis`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-recurring-obligations-design.md` §10 (Backfill) and §1 (the ratified consent ruling).

## Why this phase exists

Detecting an annual obligation requires two occurrences ≥365 days apart. The scan defaults to 90 days, so annual domain renewals, card fees, insurance and annual SaaS plans are **not merely unlikely to be found — they cannot be**, at any confidence, regardless of algorithm quality. A real inbox on 2026-08-29 contained a Namecheap auto-renewal notice that the engine structurally could not detect.

## Deviation from the spec, deliberate

Spec §10 prescribes **two passes** — `format: "metadata"` to build a skeleton
cheaply, then `raw` only for interesting messages. This plan does not do that,
because the reasoning behind it was wrong.

`messages.get` costs **5 quota units whatever the format**, so metadata saves
bandwidth but not quota — and quota was never the constraint. The constraint is
round trips × latency: ~200ms each, serially, for thousands of messages. A two-
pass scheme *adds* a round trip for every message that then needs `raw`, making
the actual bottleneck worse while optimising one that does not bind.

Bounded concurrency addresses the real limit. At ~250 units/user/second the
ceiling is ~50 `get`s/second, which roughly ten concurrent requests reaches,
taking 5,000 messages from ~17 minutes to under two. Spec §10 should be read as
superseded on this point; the chunking, cursor and no-attachments guidance in
it all still hold.

## Global Constraints

- **Owner-initiated, never automatic.** Ratified: "user-initiated, strongly prompted." A cron that starts backfilling every connection it finds violates this. `backfillRequestedAt` is the consent record, and nothing runs without it.
- **Ingestion only.** The backfill writes `EmailTransaction` and `Purchase`. Detection is a separate sweep, so a half-finished backfill degrades recall rather than producing wrong obligations.
- **Idempotent.** Re-running over already-ingested messages must be a no-op — `processRawGmailMessage` in `"scan"` mode already skips an existing transaction. Rely on that; do not add a second dedup.
- **One connection's failure is not another's.** Catch per connection, record in `lastScanError`, continue.
- `lastScanAt` records a **completed** scan (commit `6eb2ada`). Do not stamp it for a backfill chunk, and do not stamp it on failure.
- `npm run check` must pass at every commit. Baseline: 1426 tests.

---

### Task 1: Consent flag and the cursor's meaning

**Files:**
- Modify: `prisma/schema.prisma` (`model EmailConnection`)
- Create: `prisma/migrations/20260830120000_backfill_consent/migration.sql`

**Interfaces:**
- Produces: `EmailConnection.backfillRequestedAt DateTime?`. `backfillCursor` gains a defined meaning: **an ISO date (`YYYY-MM-DD`), the oldest point already covered.**

`backfillCursor` and `backfillCompletedAt` already exist (added by P2 Task 1, nothing writes them). This task adds the consent flag and pins down what the cursor holds.

**Why a date cursor and not a Gmail `pageToken`:** a page token is opaque, tied to one list query, and not guaranteed valid across invocations minutes apart. A date is stable, human-auditable, survives a query change, and makes the work naturally chunkable — each invocation walks one window further back. If the cursor is garbage, the worst case is re-ingesting a month, which is idempotent.

- [ ] **Step 1: Add the column**

```prisma
  /// When the owner asked for a historical backfill. Null means never asked,
  /// and the job must not run — the ratified ruling is owner-initiated, never
  /// automatic, because this reads two years of somebody's mail.
  backfillRequestedAt DateTime?
  /// ISO date (YYYY-MM-DD): the oldest point already covered. The job walks
  /// backwards from here. Null with a request pending means "start at today".
  backfillCursor      String?
  backfillCompletedAt DateTime?
```

- [ ] **Step 2: Migration**

```sql
ALTER TABLE "EmailConnection" ADD COLUMN "backfillRequestedAt" TIMESTAMP(3);
CREATE INDEX "EmailConnection_backfill_idx"
    ON "EmailConnection"("backfillRequestedAt")
    WHERE "backfillCompletedAt" IS NULL;
```

The partial index keeps the cron's claim query cheap as connections accumulate: it only indexes rows that could still have work.

- [ ] **Step 3: Verify**

Run: `npx prisma generate && npx tsc --noEmit && npm run check`
Expected: clean. Additive.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260830120000_backfill_consent
git commit -m "feat(email): record that an owner asked for a historical backfill"
```

---

### Task 2: Bounded-concurrency message fetch

**Files:**
- Modify: `src/lib/services/gmailScanSource.ts`
- Test: `src/lib/services/gmailScanSource.test.ts`

**Interfaces:**
- Produces: `listRawGmailMessagesInWindow(gmail, { after: Date, before: Date, max, concurrency })`, returning `RawGmailMessage[]`. The existing `listRecentRawGmailMessages` keeps its signature and behaviour.

**The actual constraint.** `listRecentRawGmailMessages` fetches serially — one `messages.get` per message. At ~200ms per round trip that is ~5 messages/second, so 5,000 messages is ~17 minutes against a 120-second cap.

**A two-pass `metadata`-then-`raw` scheme does NOT fix this.** `messages.get` costs 5 quota units whatever the format, so metadata saves bandwidth but not quota, and it *adds* a round trip for every message that then needs `raw`. The bottleneck is round trips × latency. The fix is concurrency: Gmail allows ~250 quota units per user per second, so ~50 `get`s/second, which roughly 10 concurrent requests reaches. That takes 5,000 messages from ~17 minutes to under two.

- [ ] **Step 1: Write the failing test**

```ts
it("fetches within a window rather than from a single date", async () => {
  const messages = await listRawGmailMessagesInWindow(gmail, {
    after: new Date("2026-01-01"), before: new Date("2026-02-01"), max: 500,
  });
  expect(gmail.users.messages.list).toHaveBeenCalledWith(
    expect.objectContaining({ q: expect.stringContaining("before:") }),
  );
  expect(messages).toHaveLength(3);
});

it("never exceeds the concurrency limit", async () => {
  let inFlight = 0;
  let peak = 0;
  gmail.users.messages.get.mockImplementation(async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return { data: { raw: RAW_FIXTURE, internalDate: "1767225600000" } };
  });

  await listRawGmailMessagesInWindow(gmail, { after, before, max: 50, concurrency: 4 });

  expect(peak).toBeLessThanOrEqual(4);
});

it("returns messages in a deterministic order regardless of completion order", async () => {
  // Concurrency must not make ingestion order depend on network timing, or a
  // rerun produces a different sequence and its logs cannot be compared.
  gmail.users.messages.get.mockImplementation(async ({ id }) => {
    await new Promise((r) => setTimeout(r, id === "m1" ? 20 : 1));
    return { data: { raw: rawFor(id), internalDate: "1767225600000" } };
  });

  const messages = await listRawGmailMessagesInWindow(gmail, { after, before, max: 10, concurrency: 4 });

  expect(messages.map((m) => m.messageId)).toEqual(["m1", "m2", "m3"]);
});

it("skips a message that fails without losing the rest of the batch", async () => {
  gmail.users.messages.get.mockRejectedValueOnce(new Error("404"));
  const messages = await listRawGmailMessagesInWindow(gmail, { after, before, max: 10 });
  expect(messages).toHaveLength(2);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/services/gmailScanSource.test.ts`
Expected: FAIL — `listRawGmailMessagesInWindow` is not exported.

- [ ] **Step 3: Implement**

Add a windowed query alongside `buildReceiptQuery`:

```ts
/** The receipt query bounded at both ends, for walking history backwards. */
export function buildReceiptQueryForWindow(after: Date, before: Date): string {
  const a = `after:${Math.floor(after.getTime() / 1000)}`;
  const b = `before:${Math.floor(before.getTime() / 1000)}`;
  const subjectTerms = `subject:(${RECEIPT_TERMS.join(" OR ")})`;
  return `${a} ${b} -category:promotions -category:social (category:purchases OR ${subjectTerms})`;
}
```

Then list ids by paging as the existing function does, and fetch with a bounded worker pool (default concurrency 8 — under the ~50/sec ceiling with headroom, since quota is shared with the scan). **Preserve id order in the result** by writing each fetch into its slot rather than pushing on completion. A failed `get` is logged and skipped, never fatal.

Keep the per-message parsing identical to `listRecentRawGmailMessages` — subject, from, internalDate, `rfc822MessageId` — by extracting the shared body into one helper both call. Do not let the two drift.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/services/`
Expected: PASS, existing cases included.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/gmailScanSource.ts src/lib/services/gmailScanSource.test.ts
git commit -m "feat(gmail): fetch a date window with bounded concurrency"
```

---

### Task 3: The backfill job

**Files:**
- Create: `src/lib/domain/receipts/gmailBackfill.ts`
- Test: `src/lib/domain/receipts/gmailBackfill.test.ts`

**Interfaces:**
- Consumes: Task 2's `listRawGmailMessagesInWindow`, `processRawGmailMessage`, `getAuthedGmail(connectionId)`.
- Produces: `runBackfillChunk(db, { connectionId, windowDays, maxMessages, now })` returning `{ processed, imported, windowFrom, windowTo, done }`.

One invocation advances one connection by one window. The cron calls it repeatedly.

- [ ] **Step 1: Write the failing test**

```ts
it("starts at today when no cursor is set", async () => {
  const result = await runBackfillChunk(db, { connectionId: "conn-a", windowDays: 30, maxMessages: 500, now });
  expect(result.windowTo).toEqual(isoDate(now));
  expect(await cursorFor("conn-a")).toBe(result.windowFrom);
});

it("resumes from the stored cursor, walking backwards", async () => {
  await setCursor("conn-a", "2026-05-01");
  const result = await runBackfillChunk(db, { connectionId: "conn-a", windowDays: 30, maxMessages: 500, now });
  expect(result.windowTo).toBe("2026-05-01");
  expect(result.windowFrom).toBe("2026-04-01");
});

it("marks the backfill complete once it reaches 24 months back", async () => {
  await setCursor("conn-a", isoDate(monthsAgo(24)));
  const result = await runBackfillChunk(db, { connectionId: "conn-a", windowDays: 30, maxMessages: 500, now });
  expect(result.done).toBe(true);
  expect(await completedAtFor("conn-a")).toBeInstanceOf(Date);
});

it("refuses to run without owner consent", async () => {
  await clearRequestedAt("conn-a");
  await expect(runBackfillChunk(db, { connectionId: "conn-a", windowDays: 30, maxMessages: 500, now }))
    .rejects.toThrow(/not requested/i);
});

it("is idempotent — a rerun over the same window imports nothing new", async () => {
  await runBackfillChunk(db, chunkArgs);
  await setCursor("conn-a", isoDate(now));
  const second = await runBackfillChunk(db, chunkArgs);
  expect(second.imported).toBe(0);
});

it("does not advance the cursor when the window fails", async () => {
  // Advancing past a window that threw would silently skip that month, and
  // nothing downstream could tell the gap from an empty month.
  vi.mocked(listRawGmailMessagesInWindow).mockRejectedValueOnce(new Error("invalid_grant"));
  await expect(runBackfillChunk(db, chunkArgs)).rejects.toThrow();
  expect(await cursorFor("conn-a")).toBe("2026-05-01");
});

it("does not stamp lastScanAt", async () => {
  await runBackfillChunk(db, chunkArgs);
  expect(await lastScanAtFor("conn-a")).toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement**

Read `backfillRequestedAt` and throw if null. Compute the window as `[cursor - windowDays, cursor]`, defaulting `cursor` to today. Fetch via Task 2, feed each message to `processRawGmailMessage` in `"scan"` mode (which skips already-ingested transactions — that is the idempotency). **Advance the cursor only after the window's messages are processed.** When the window's start passes 24 months ago, set `backfillCompletedAt`.

Do not persist attachments during backfill: it exists to establish cadence, not to archive receipts, and two years of PDFs is object-storage cost with no bearing on detection. If `processRawGmailMessage` writes them unconditionally, add an explicit option rather than duplicating the function.

- [ ] **Step 4: Run the tests, then `npm run check`**

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/receipts/gmailBackfill.ts src/lib/domain/receipts/gmailBackfill.test.ts
git commit -m "feat(receipts): walk one connection's history backwards, one window at a time"
```

---

### Task 4: Cron driver

**Files:**
- Create: `src/app/api/cron/gmail-backfill/route.ts`
- Test: `src/app/api/cron/gmail-backfill/route.test.ts`
- Modify: `scripts/ops/qstash-schedules.config.mjs`

**Interfaces:**
- Consumes: Task 3's `runBackfillChunk`.

- [ ] **Step 1: Read the conventions**

Read `src/app/api/cron/recurring-sweep/route.ts` (P6 added it) and copy its authentication, batching and response shape. Read `scripts/ops/qstash-schedules.config.mjs` **and its test**: schedule ids are frozen, because renaming one creates a second QStash schedule and orphans the first. Adding is fine. This repo has a `cron-schedule-change` skill — invoke it.

- [ ] **Step 2: Write the failing test**

```ts
it("rejects an unauthenticated request", async () => {
  expect((await GET(new Request("http://localhost/api/cron/gmail-backfill"))).status).toBe(401);
});

it("claims only connections with consent and no completion", async () => {
  const body = await (await GET(authedRequest())).json();
  expect(body.connections.map((c) => c.connectionId)).toEqual(["conn-requested"]);
});

it("keeps going when one connection fails", async () => {
  vi.mocked(runBackfillChunk).mockRejectedValueOnce(new Error("invalid_grant"));
  const response = await GET(authedRequest());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.connections).toContainEqual(expect.objectContaining({ error: "invalid_grant" }));
});
```

- [ ] **Step 3: Implement**

`export const runtime = "nodejs"` and `export const maxDuration = 120`. Select connections `WHERE "backfillRequestedAt" IS NOT NULL AND "backfillCompletedAt" IS NULL`, using `FOR UPDATE SKIP LOCKED` so two overlapping invocations cannot process one connection twice — mirror the pattern in `claimDueDigestJobs`. Process a bounded number of chunks per invocation, tracking elapsed time and stopping before `maxDuration`. Record a failure in `lastScanError` and continue.

- [ ] **Step 4: Run the tests, then `npm run check`**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/gmail-backfill scripts/ops/qstash-schedules.config.mjs
git commit -m "feat(cron): advance requested Gmail backfills"
```

---

### Task 5: Asking for it, and watching it run

**Files:**
- Create: `src/app/api/gmail/backfill/route.ts`
- Modify: `src/app/settings/automation/page.tsx`
- Test: `src/app/api/gmail/backfill/route.test.ts`

**Interfaces:**
- Produces: `POST /api/gmail/backfill` `{ connectionId }` setting `backfillRequestedAt`; `GET` returning progress.

- [ ] **Step 1: Write the failing test**

```ts
it("records consent for the owner's own connection", async () => {
  await POST(authedRequest({ connectionId: "conn-a" }));
  expect(await requestedAtFor("conn-a")).toBeInstanceOf(Date);
});

it("refuses a connection belonging to someone else", async () => {
  const response = await POST(authedRequest({ connectionId: "someone-elses" }));
  expect(response.status).toBe(404);
  expect(await requestedAtFor("someone-elses")).toBeNull();
});

it("reports progress as months covered", async () => {
  await setCursor("conn-a", isoDate(monthsAgo(6)));
  const body = await (await GET(authedRequest())).json();
  expect(body.connections[0]).toMatchObject({ monthsCovered: 6, monthsTarget: 24, complete: false });
});
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement**

Scope by `{ id, userId }` — that is the authorization check, not a filter; a zero-count update is a 404.

The settings UI gets a per-connection action. **Say what it does before it does it** — this reads two years of the owner's mail, and the ratified ruling is that it is prompted, not silent. Wording along the lines of "Find my subscriptions — we'll scan 2 years of receipts to spot recurring charges", with progress once running (`monthsCovered / 24`) and a completion state. A multi-minute job with no progress surface reads as broken.

- [ ] **Step 4: Run the tests, then `npm run check`**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gmail/backfill src/app/settings/automation/page.tsx
git commit -m "feat(settings): let an owner ask for a historical backfill"
```

---

### Task 6: Run it, and see what appears

**Files:**
- Create: `scripts/ops/runBackfillForOwner.ts`

- [ ] **Step 1: Write the script**

Follow `scripts/ops/reconcileMerchantIdentity.ts` for conventions: dotenv, `PrismaPg` + `Pool` (Prisma 7 rejects a bare `new PrismaClient()`), dry run by default with `--apply`, corpus totals so a zero result is unambiguous. Note the parser is `server-only`, so it needs `npx tsx --conditions=react-server` — see `scripts/ops/reprocessReceipts.ts`.

- [ ] **Step 2: Run it and report honestly**

Before: 60 email transactions, 54 purchases, one detected obligation (`anthropic.com [USD]` MONTHLY, coverage 1.00), 6 purchases skipped for missing currency.

Report the new corpus size, then run `sweepRecurringForOwner.ts` and report what detection finds with two years instead of three months. **The specific thing to check: does the Namecheap annual domain renewal now appear?** It is the case a 90-day window could not see at any confidence, and it is the reason this phase exists.

Report false positives with more prominence than new detections. A backfill multiplies the corpus, and precision problems that were invisible at 57 purchases become obvious at several hundred.

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/runBackfillForOwner.ts
git commit -m "feat(ops): run an owner's historical backfill from the command line"
```

---

## Out of scope

- IMAP backfill. Gmail only this phase; `imapClient.ts` keeps its shape.
- Any detection change. The sweep reads whatever the spine holds; more history is the only input that changes.
- Attachment archiving. Deliberately skipped during backfill.
- P7 (PickMe contract), P8 (measurement), and the deferred `Bill`/`Subscription` collapse.
