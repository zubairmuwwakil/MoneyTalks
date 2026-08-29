# Multi-Account Email Connections + Cross-Mailbox Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one owner connect several email accounts, and stop the same receipt arriving in two of them from becoming two purchases.

**Architecture:** `EmailConnection` stops being a per-user singleton and becomes per-user-many keyed on `(userId, provider, emailAddress)`. Every connection carries its own OAuth tokens, scan cursor and scan mode. `EmailTransaction` gains the RFC822 `Message-ID` **header** — which is stable across mailboxes, unlike the per-mailbox id Gmail assigns — and receipt promotion consults it so a second copy of a receipt links to the existing `Purchase` instead of creating a rival one.

**Tech Stack:** Next.js App Router (`runtime = "nodejs"`), Prisma 7 + Postgres, `googleapis`, `mailparser`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-recurring-obligations-design.md` — especially §9 (Multi-account) and §8 (Idempotency and deduplication). Read it before Task 1.

## Global Constraints

- Multi-account is a **precision** prerequisite, not a convenience feature. A history split across inboxes suppresses detection, and an undeduplicated one inflates it: the same monthly subscription seen in two mailboxes reads as **biweekly**, doubling projected annual spend and feeding that to PickMe's card maths.
- `MerchantAlias` is shared with the wallet capture path. Never key anything in this work on a connection instead of a user — obligation and merchant identity are per **user**, never per mailbox.
- OAuth secrets are encrypted at rest via `src/lib/security/emailConnectionSecrets.ts`. Never store, log, or return a plaintext token. Decrypt in memory only.
- Google OAuth stays in testing mode (containment ruling). Do not add scopes.
- Every route touched keeps `export const runtime = "nodejs"`.
- `npm run check` must pass at every commit. Baseline is 146 test files / 1271 tests.
- Migrations are directories under `prisma/migrations/<YYYYMMDDHHMMSS>_<snake_name>/migration.sql`, applied by `prisma migrate deploy` during `npm run build`.

---

### Task 1: Schema — connections become per-user-many, transactions carry the RFC822 id

**Files:**
- Modify: `prisma/schema.prisma` (`model EmailConnection`, `model EmailTransaction`)
- Create: `prisma/migrations/20260829160000_multi_account_email/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `EmailConnection` without `userId @unique`, with `@@unique([userId, provider, emailAddress])`, `emailAddress String` (NOT NULL), and `backfillCursor String?` / `backfillCompletedAt DateTime?` reserved for phase P3. `EmailTransaction.connectionId String?` and `EmailTransaction.rfc822MessageId String?`, plus `@@index([userId, rfc822MessageId])`.

- [ ] **Step 1: Edit the Prisma schema**

In `model EmailConnection`, change `userId String @unique` to `userId String`, change `emailAddress String?` to `emailAddress String`, and add:

```prisma
  backfillCursor      String?
  backfillCompletedAt DateTime?

  emailTransactions   EmailTransaction[]

  @@unique([userId, provider, emailAddress])
  @@index([userId])
```

In `model EmailTransaction`, add:

```prisma
  connectionId     String?
  rfc822MessageId  String?
  connection       EmailConnection? @relation(fields: [connectionId], references: [id], onDelete: SetNull)
```

and add `@@index([userId, rfc822MessageId])`. Leave `@@unique([userId, provider, messageId])` alone — it still guards per-mailbox replays.

- [ ] **Step 2: Write the migration SQL**

`emailAddress` must become NOT NULL before the unique index can be trusted: Postgres treats NULLs as distinct, so a nullable column would let two unidentified connections coexist for one user and silently defeat the constraint.

```sql
-- A connection whose address we never learned cannot be told apart from
-- another one. Keep the row and its tokens (deleting an owner's grant is
-- not a migration's decision) but give it a visibly invalid address so the
-- settings UI shows it as needing reconnection.
UPDATE "EmailConnection"
   SET "emailAddress" = 'unknown+' || "id" || '@invalid'
 WHERE "emailAddress" IS NULL;

ALTER TABLE "EmailConnection" ALTER COLUMN "emailAddress" SET NOT NULL;
DROP INDEX IF EXISTS "EmailConnection_userId_key";
CREATE UNIQUE INDEX "EmailConnection_userId_provider_emailAddress_key"
    ON "EmailConnection"("userId", "provider", "emailAddress");
CREATE INDEX "EmailConnection_userId_idx" ON "EmailConnection"("userId");

ALTER TABLE "EmailConnection" ADD COLUMN "backfillCursor" TEXT;
ALTER TABLE "EmailConnection" ADD COLUMN "backfillCompletedAt" TIMESTAMP(3);

ALTER TABLE "EmailTransaction" ADD COLUMN "connectionId" TEXT;
ALTER TABLE "EmailTransaction" ADD COLUMN "rfc822MessageId" TEXT;
ALTER TABLE "EmailTransaction"
  ADD CONSTRAINT "EmailTransaction_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "EmailConnection"("id") ON DELETE SET NULL;
CREATE INDEX "EmailTransaction_userId_rfc822MessageId_idx"
    ON "EmailTransaction"("userId", "rfc822MessageId");

-- Existing transactions belong to the owner's only connection.
UPDATE "EmailTransaction" t
   SET "connectionId" = c."id"
  FROM "EmailConnection" c
 WHERE c."userId" = t."userId";
```

- [ ] **Step 3: Regenerate the client and confirm the schema compiles**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: both succeed. TypeScript will now flag `findUnique({ where: { userId } })` on `emailConnection` at every call site — that is the point, and Tasks 4 and 8 fix them. If the count is not 11, re-read `git grep -n "emailConnection\." -- src` before continuing.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260829160000_multi_account_email
git commit -m "feat(email): allow many connections per owner, carry RFC822 message id"
```

---

### Task 2: Capture the RFC822 Message-ID during scanning

**Files:**
- Modify: `src/lib/services/gmailScanSource.ts` (`RawGmailMessage`, the message assembly in `listRecentRawGmailMessages`)
- Test: `src/lib/services/gmailScanSource.test.ts`

**Interfaces:**
- Consumes: Task 1's schema.
- Produces: `RawGmailMessage` gains `rfc822MessageId: string | null`.

The file already has a `headerValue(headerBlock, name)` helper that unfolds RFC 5322 continuation lines. Reuse it — do not write a second header parser.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { extractRfc822MessageId } from "./gmailScanSource";

describe("extractRfc822MessageId", () => {
  it("reads the header and strips the angle brackets", () => {
    const raw = "From: a@b.com\r\nMessage-ID: <abc123@netflix.com>\r\nSubject: hi\r\n\r\nbody";
    expect(extractRfc822MessageId(raw)).toBe("abc123@netflix.com");
  });

  it("is case-insensitive about the header name", () => {
    const raw = "message-id: <x@y.z>\r\n\r\nbody";
    expect(extractRfc822MessageId(raw)).toBe("x@y.z");
  });

  it("unfolds a header split across lines", () => {
    const raw = "Message-ID:\r\n <folded@example.com>\r\n\r\nbody";
    expect(extractRfc822MessageId(raw)).toBe("folded@example.com");
  });

  it("returns null when the header is absent", () => {
    expect(extractRfc822MessageId("Subject: no id here\r\n\r\nbody")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/services/gmailScanSource.test.ts`
Expected: FAIL — `extractRfc822MessageId` is not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * The RFC822 `Message-ID` header, which the SENDER assigns and which is
 * therefore identical in every mailbox the message reaches. Gmail's own
 * message id is per-mailbox, so it cannot tell "the same receipt, twice"
 * from "two receipts".
 */
export function extractRfc822MessageId(raw: string): string | null {
  const headerBlock = raw.split(/\r?\n\r?\n/)[0] ?? "";
  const value = headerValue(headerBlock, "Message-ID");
  if (!value) return null;
  const angled = value.match(/<([^>]+)>/);
  return (angled ? angled[1] : value).trim() || null;
}
```

Add `rfc822MessageId: string | null` to the `RawGmailMessage` type and populate it where each message is assembled, from the decoded raw source.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/services/gmailScanSource.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/gmailScanSource.ts src/lib/services/gmailScanSource.test.ts
git commit -m "feat(email): capture the sender-assigned RFC822 message id"
```

---

### Task 3: Cross-mailbox dedup on receipt promotion

**Files:**
- Modify: `src/lib/domain/receipts/gmailReceiptProcessing.ts` (`processRawGmailMessage`, `promotePurchase`)
- Test: `src/lib/domain/receipts/gmailReceiptProcessing.test.ts`

**Interfaces:**
- Consumes: Task 2's `RawGmailMessage.rfc822MessageId`.
- Produces: `processRawGmailMessage` links a duplicate to the existing `Purchase` and reports `purchaseAction: "linked"`.

This is the precision fix and the reason the phase exists. `src/lib/domain/spine/purchaseMerge.ts` states that match candidates come **only from other sources**, so two GMAIL-sourced observations never merge through it. Same-source dedup rests entirely on `Purchase @@unique([userId, sourceEmailId])`, and `sourceEmailId` is Gmail's per-mailbox id — which differs between mailboxes for the same email. Without this task, the same subscription seen in two inboxes reads as biweekly.

- [ ] **Step 1: Write the failing test**

```ts
it("links a receipt already ingested from another mailbox instead of creating a rival purchase", async () => {
  // Same sender-assigned Message-ID, different Gmail per-mailbox ids —
  // exactly what one receipt delivered to two of the owner's addresses looks like.
  const first = await processRawGmailMessage(db, {
    userId: "user-1",
    message: rawMessage({ messageId: "gmail-inbox-a", rfc822MessageId: "receipt-1@netflix.com" }),
    mode: "scan",
  });
  const second = await processRawGmailMessage(db, {
    userId: "user-1",
    message: rawMessage({ messageId: "gmail-inbox-b", rfc822MessageId: "receipt-1@netflix.com" }),
    mode: "scan",
  });

  expect(second.purchaseAction).toBe("linked");
  expect(second.transaction.purchaseId).toBe(first.transaction.purchaseId);
  expect(await db.purchase.count({ where: { userId: "user-1" } })).toBe(1);
});

it("still creates separate purchases for genuinely different receipts", async () => {
  await processRawGmailMessage(db, {
    userId: "user-1",
    message: rawMessage({ messageId: "gmail-a", rfc822MessageId: "receipt-1@netflix.com" }),
    mode: "scan",
  });
  await processRawGmailMessage(db, {
    userId: "user-1",
    message: rawMessage({ messageId: "gmail-b", rfc822MessageId: "receipt-2@netflix.com" }),
    mode: "scan",
  });
  expect(await db.purchase.count({ where: { userId: "user-1" } })).toBe(2);
});

it("does not deduplicate across owners", async () => {
  // Two people can be sent the same newsletter-style receipt id.
  await processRawGmailMessage(db, {
    userId: "user-1",
    message: rawMessage({ messageId: "g-1", rfc822MessageId: "shared@vendor.com" }),
    mode: "scan",
  });
  await processRawGmailMessage(db, {
    userId: "user-2",
    message: rawMessage({ messageId: "g-2", rfc822MessageId: "shared@vendor.com" }),
    mode: "scan",
  });
  expect(await db.purchase.count()).toBe(2);
});
```

Extend the file's existing raw-message factory with an `rfc822MessageId` field rather than writing a new one.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/domain/receipts/gmailReceiptProcessing.test.ts`
Expected: FAIL — the first test finds 2 purchases.

- [ ] **Step 3: Implement**

Persist `rfc822MessageId` and `connectionId` in `emailTransactionData`. Then, inside `promotePurchase`, add a lookup **after** the existing `purchaseId` / `sourceEmailId` checks and **before** `findMatchingPurchase`:

```ts
  // A prior canonical link wins, then this email's own source key. Failing
  // both, the same message may already have been ingested from another of
  // this owner's mailboxes: Gmail's id is per-mailbox, the sender's
  // Message-ID is not. Scoped to userId — two people can receive receipts
  // carrying the same sender-assigned id.
  if (!purchase && emailTransaction.rfc822MessageId) {
    const twin = await db.emailTransaction.findFirst({
      where: {
        userId,
        rfc822MessageId: emailTransaction.rfc822MessageId,
        id: { not: emailTransaction.id },
        purchaseId: { not: null },
      },
      select: { purchaseId: true },
    });
    if (twin?.purchaseId) {
      purchase = await db.purchase.findUnique({ where: { id: twin.purchaseId } });
      if (purchase) action = "linked";
    }
  }
```

Leave the rest of the promotion path untouched — the existing `emailTransaction.purchaseId !== purchase.id` block already writes the link.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/domain/receipts/`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/receipts/gmailReceiptProcessing.ts src/lib/domain/receipts/gmailReceiptProcessing.test.ts
git commit -m "fix(receipts): link a receipt already ingested from another mailbox"
```

---

### Task 4: `getAuthedGmail` addresses one connection

**Files:**
- Modify: `src/lib/services/gmailClient.ts:15-70`
- Test: `src/lib/services/gmailClient.test.ts`

**Interfaces:**
- Consumes: Task 1's schema.
- Produces: `getAuthedGmail(connectionId: string)` returning `{ gmail, oauth2, conn, flushTokens } | null`. Also `listUserConnections(userId: string): Promise<EmailConnection[]>`.

- [ ] **Step 1: Write the failing test**

```ts
it("authenticates the named connection, not the owner's first", async () => {
  const result = await getAuthedGmail("conn-b");
  expect(result?.conn.id).toBe("conn-b");
});

it("persists refreshed tokens against the same connection", async () => {
  const result = await getAuthedGmail("conn-b");
  result!.oauth2.emit("tokens", { access_token: "fresh", expiry_date: Date.now() + 3600_000 });
  await result!.flushTokens();
  expect(prisma.emailConnection.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "conn-b" } }),
  );
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/services/gmailClient.test.ts`
Expected: FAIL — the function takes a userId.

- [ ] **Step 3: Implement**

Change the lookup to `prisma.emailConnection.findUnique({ where: { id: connectionId } })`, and change the `tokens` listener's persist to `where: { id: connectionId }`. Secrets are keyed by owner, so keep passing `conn.userId` — **not** the connection id — to `readConnectionSecret` and `encryptConnectionSecrets`; getting this backwards makes every stored token undecryptable. Add:

```ts
export async function listUserConnections(userId: string) {
  return prisma.emailConnection.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/services/gmailClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/gmailClient.ts src/lib/services/gmailClient.test.ts
git commit -m "refactor(gmail): authenticate a named connection"
```

---

### Task 5: Connecting an additional account

**Files:**
- Modify: `src/app/api/gmail/callback/route.ts:41-70`, `src/app/api/gmail/connect/route.ts`
- Test: `src/app/api/gmail/callback/route.test.ts`

**Interfaces:**
- Consumes: Task 1's `@@unique([userId, provider, emailAddress])`.
- Produces: repeat consent for the same address updates that connection; a new address adds one.

- [ ] **Step 1: Write the failing test**

```ts
it("adds a second connection for a different address", async () => {
  await connectAs("first@gmail.com");
  await connectAs("second@gmail.com");
  expect(await prisma.emailConnection.count({ where: { userId: "user-1" } })).toBe(2);
});

it("updates in place when the same address reconnects", async () => {
  await connectAs("first@gmail.com");
  await connectAs("first@gmail.com");
  expect(await prisma.emailConnection.count({ where: { userId: "user-1" } })).toBe(1);
});

it("refuses a grant that returned no address", async () => {
  // Without an address the connection cannot be told apart from another,
  // so it must not be stored at all.
  const res = await connectWithUserinfo({ email: null });
  expect(res.status).toBe(400);
  expect(await prisma.emailConnection.count()).toBe(0);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/api/gmail/callback/route.test.ts`
Expected: FAIL — the upsert keys on `userId`, so the second address overwrites the first.

- [ ] **Step 3: Implement**

Guard the missing address, then key the upsert on the compound unique:

```ts
  const emailAddress = me.data.email;
  if (!emailAddress) {
    return new NextResponse("Google did not return an email address for this account", { status: 400 });
  }

  await prisma.emailConnection.upsert({
    where: { userId_provider_emailAddress: { userId, provider: "GMAIL", emailAddress } },
    create: {
      userId,
      provider: "GMAIL",
      emailAddress,
      ...encryptConnectionSecrets(userId, {
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
      }),
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
    },
    update: {
      provider: "GMAIL",
      emailAddress,
      ...encryptConnectionSecrets(userId, {
        accessToken: tokens.access_token ?? null,
        // `undefined`, not `null`: a refresh token only arrives on FIRST
        // consent, and writing null would erase the one already stored.
        refreshToken: tokens.refresh_token ?? undefined,
      }),
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
    },
  });
```

Leave `encryptConnectionSecrets(userId, ...)` keyed on `userId`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/gmail/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gmail/callback/route.ts src/app/api/gmail/connect/route.ts src/app/api/gmail/callback/route.test.ts
git commit -m "feat(gmail): connect more than one account per owner"
```

---

### Task 6: Fan the scan out across connections

**Files:**
- Modify: `src/app/api/automation/scan/route.ts`, `src/app/api/automation/reprocess/route.ts`
- Test: `src/app/api/automation/scan/route.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: the scan response gains `perConnection: { connectionId, emailAddress, fetched, imported, skipped }[]`; existing top-level totals keep their names and meanings.

- [ ] **Step 1: Write the failing test**

```ts
it("scans every connection and reports per-connection totals", async () => {
  const res = await POST(requestFor({ days: 90 }));
  const body = await res.json();
  expect(body.perConnection).toHaveLength(2);
  expect(body.importedEmails).toBe(
    body.perConnection.reduce((n: number, c: { imported: number }) => n + c.imported, 0),
  );
});

it("keeps scanning after one connection fails", async () => {
  // A revoked grant on one mailbox must not cost the owner the other one.
  gmailFor("conn-a").mockRejectedValue(new Error("invalid_grant"));
  const res = await POST(requestFor({ days: 90 }));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.perConnection).toContainEqual(expect.objectContaining({ connectionId: "conn-a", error: "invalid_grant" }));
  expect(body.perConnection).toContainEqual(expect.objectContaining({ connectionId: "conn-b", error: undefined }));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/api/automation/scan/route.test.ts`
Expected: FAIL — `perConnection` is undefined.

- [ ] **Step 3: Implement**

Wrap the existing per-message body in a loop over connections. Set `connectionId` on every `EmailTransaction` written, and pass each `connection.scanMode` into the existing allow-list logic instead of reading one mode for the owner.

```ts
const connections = await listUserConnections(userId);
const perConnection: ConnectionResult[] = [];

for (const connection of connections) {
  const result: ConnectionResult = {
    connectionId: connection.id,
    emailAddress: connection.emailAddress,
    fetched: 0, imported: 0, skipped: 0,
  };
  try {
    const authed = await getAuthedGmail(connection.id);
    if (!authed) throw new Error("not_connected");

    // ...existing per-message body, unchanged, but reading
    // connection.scanMode and writing connectionId: connection.id...

    await authed.flushTokens();
    await prisma.emailConnection.update({
      where: { id: connection.id },
      data: { lastScanAt: new Date() },
    });
  } catch (error) {
    // One revoked grant must not cost the owner their other mailboxes.
    result.error = error instanceof Error ? error.message : String(error);
  }
  perConnection.push(result);
}

const totals = perConnection.reduce(
  (acc, c) => ({
    importedEmails: acc.importedEmails + c.imported,
    skipped: acc.skipped + c.skipped,
    fetched: acc.fetched + c.fetched,
  }),
  { importedEmails: 0, skipped: 0, fetched: 0 },
);

return NextResponse.json({ ok: true, ...totals, perConnection });
```

Delete the `prisma.emailConnection.updateMany({ where: { userId } })` in the old `finally` block — `lastScanAt` is now stamped per connection, and stamping it for a mailbox that threw would claim a scan that never happened.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/automation/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/automation/scan/route.ts src/app/api/automation/reprocess/route.ts src/app/api/automation/scan/route.test.ts
git commit -m "feat(automation): scan every connected mailbox"
```

---

### Task 7: Settings UI for several connections

**Files:**
- Modify: `src/app/api/gmail/status/route.ts`, `src/app/api/gmail/scan-mode/route.ts`, `src/app/api/gmail/disconnect/route.ts`, `src/app/settings/automation/page.tsx`
- Test: `src/app/api/gmail/status/route.test.ts`

**Interfaces:**
- Consumes: Task 4's `listUserConnections`.
- Produces: `GET /api/gmail/status` returns `{ connections: [{ id, emailAddress, connected, needsReauth, gmailScopeGranted, scanMode, lastScanAt }] }`. `scan-mode` and `disconnect` both take a `connectionId`.

- [ ] **Step 1: Write the failing test**

```ts
it("reports each connection separately", async () => {
  const body = await (await GET()).json();
  expect(body.connections).toHaveLength(2);
  expect(body.connections[0]).toMatchObject({ emailAddress: "first@gmail.com", connected: true });
});

it("marks only the connection missing the Gmail scope as needing reauth", async () => {
  const body = await (await GET()).json();
  expect(body.connections.find((c) => c.id === "conn-b").needsReauth).toBe(true);
  expect(body.connections.find((c) => c.id === "conn-a").needsReauth).toBe(false);
});

it("disconnects one mailbox and leaves the other", async () => {
  await DISCONNECT(requestFor({ connectionId: "conn-a" }));
  expect(await prisma.emailConnection.count({ where: { userId: "user-1" } })).toBe(1);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/api/gmail/status/route.test.ts`
Expected: FAIL — the response has no `connections` array.

- [ ] **Step 3: Implement**

Lift the existing single-connection derivation into a helper and map it, so the rules stay in one place:

```ts
function describeConnection(conn: EmailConnection) {
  const hasRefresh = Boolean(conn.refreshToken);
  const hasAccess = Boolean(conn.accessToken);
  const notExpired = conn.expiry ? conn.expiry.getTime() > Date.now() : true;
  const hasTokens = hasRefresh || (hasAccess && notExpired);
  // A grant without the Gmail scope can authenticate but never read mail.
  const gmailScopeGranted = hasGmailReadScope(conn.scope);
  return {
    id: conn.id,
    emailAddress: conn.emailAddress,
    connected: hasTokens && gmailScopeGranted,
    needsReauth: !hasTokens || !gmailScopeGranted || conn.emailAddress.endsWith("@invalid"),
    gmailScopeGranted,
    scanMode: conn.scanMode,
    lastScanAt: conn.lastScanAt,
  };
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const connections = await listUserConnections(userId);
  return NextResponse.json({ connections: connections.map(describeConnection) });
}
```

Scan-mode and disconnect both take a `connectionId` and must scope by owner as well as id, or one owner could address another's connection:

```ts
const { connectionId, scanMode } = await req.json();
const updated = await prisma.emailConnection.updateMany({
  where: { id: connectionId, userId },   // userId is the authorization check
  data: { scanMode },
});
if (updated.count === 0) return new NextResponse("Not found", { status: 404 });
```

In `page.tsx`, render one row per connection — address, scan mode, last scan, a per-row disconnect — plus a "Connect another account" action pointing at the existing connect route. A row whose `needsReauth` is true (including Task 1's `@invalid` backfill addresses) renders a reconnect prompt.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/gmail/ && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gmail src/app/settings/automation/page.tsx
git commit -m "feat(settings): manage each connected mailbox separately"
```

---

### Task 8: Retire the remaining singleton readers

**Files:**
- Modify: `src/app/api/data/export/route.ts:27`, `src/app/api/data/summary/route.ts:40`, `src/app/api/data/delete/route.ts:49`, `src/app/settings/PrivacySettings.tsx:23,196`
- Test: `src/app/api/data/export/route.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: no `findUnique({ where: { userId } })` against `emailConnection` remains.

- [ ] **Step 1: Write the failing test**

```ts
it("exports every connection", async () => {
  const body = await (await GET()).json();
  expect(body.emailConnections).toHaveLength(2);
  expect(JSON.stringify(body)).not.toContain("refresh-token-plaintext");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/api/data/export/route.test.ts`
Expected: FAIL — the export carries a single `emailConnection` object.

- [ ] **Step 3: Implement**

Change export to `findMany` and rename the payload key to `emailConnections`, keeping the existing secret-redaction. `delete` and `summary` already use `deleteMany` / `count` and need no change — confirm by reading them. Update `PrivacySettings.tsx` to read the count from the array.

- [ ] **Step 4: Verify nothing singleton remains**

Run: `git grep -n "emailConnection.findUnique" -- src`
Expected: no results.
Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/data src/app/settings/PrivacySettings.tsx
git commit -m "refactor(privacy): treat email connections as a collection everywhere"
```

---

## Out of scope

- The 24-month backfill job (phase P3). Task 1 adds `backfillCursor` / `backfillCompletedAt` so P3 needs no second migration, but nothing writes them here.
- IMAP multi-account. `src/lib/services/imapClient.ts` keeps its current shape; only the Gmail path becomes multi-account in this phase.
- Any `RecurringObligation` model or detection work (phases P4–P6).
