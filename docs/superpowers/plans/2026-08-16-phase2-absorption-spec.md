# Phase 2 — Absorption spec: return-saas into MoneyTalks

**Status:** Approved 2026-08-16 (forks ratified in chat: **Clerk-first**; **solo data → re-ingest cutover**, Looply decommissioned after parity).
**Parent decisions:** `../decisions/2026-08-16-one-money-app.md` (4, 5, 8, 9, 10).
**Goal:** return-saas's three keeper pieces — email/receipt ingestion, returns/refunds domain, notification/digest queue — run inside MoneyTalks on one database behind Clerk; the standalone Looply deployment is retired.
**Precondition:** return-saas dead-code collapse (task_efef0fda) landed — this spec targets the post-cleanup tree (no shims, no dead models).

## Identity model (the Clerk-first payoff)

MoneyTalks keeps its `User` table as the FK anchor. Add `clerkId String? @unique`; `requireUserId()` becomes: Clerk `auth()` → find `User` by `clerkId`, bootstrapping by verified email match on first login (sets `clerkId`, preserving all existing rows). **Same Clerk application as return-saas**, so your existing identity carries over. Absorbed tables adopt `User.id` FKs like every other MoneyTalks table — allowed only because cutover is re-ingest, so no Clerk-string-keyed rows ever migrate.

## Known collisions (resolved here, not during implementation)

| Collision | Resolution |
|---|---|
| **`Bill`/`BillPayment` exist in both** | MoneyTalks' wins (richer: cadence/schedule JSON + 232-test engine; ownership map says planning = Money Core). return-saas's bill models, routes, and UI do **not** move. Detection lands as `DetectedItem`/`AutomationSuggestion`, and a confirmed BILL suggestion **creates/updates a MoneyTalks Bill** — the detect→plan handoff from the review, finally real. |
| **`FxRate` exists in both** (per-user vs global) | MoneyTalks' per-user table wins (Money Core owns FX). Absorbed `valueSummary` adapts or defers to Money Core's `convertMinor`. |
| **Prisma 6.19 vs 7.2** | MoneyTalks upgrades to Prisma 7 as chunk β0, *before* any schema merge. |
| **Subscriptions** | No MoneyTalks equivalent — `Subscription`/`SubscriptionPayment` move as-is under Purchase Intelligence (renewal detection feeds the digest; a confirmed recurring charge may also propose a Money Core Bill). |
| **Auth.js tables** | Kept during transition, dropped in ε after Clerk login is proven. |
| **Layering** | MoneyTalks' three-layer rule holds: absorbed pure logic (return-window math, digest building, event keys) → `src/engine/`, I/O (gmail/imap/prisma/resend) → `src/lib/`, routes stay thin. The move is also a re-layering. |

## Chunks (sequence: α → β0 → β → γ → δ → ε; each chippable with routing)

**α — Clerk migration in MoneyTalks** · `sonnet-5 @ high`
Swap Auth.js → Clerk (same app as return-saas): middleware, login page, `requireUser*`, allowlist preserved (Clerk allowlist or an email check at bootstrap). **Riskiest bit is e2e**: today's specs forge Auth.js DB sessions (`e2e/helpers/session.ts`); rework on `@clerk/testing` tokens. Verify: vitest + full e2e green, manual login. *You provide: Clerk keys in MoneyTalks env.*

**β0 — Prisma 7 upgrade** · `sonnet-5 @ medium` · Verify: `prisma validate`, vitest, build.

**β — Schema merge** · `sonnet-5 @ high`
Port absorbed models into MoneyTalks' schema with `User.id` FKs: `EmailConnection` (encrypted columns), `EmailTransaction`, `ReceiptDocument`, `Purchase(+Item,+Attachment)`, `ReturnItem`, `ShipmentEvent`, `RefundCase`, `Subscription(+Payment)`, `DetectedItem`, `AutomationSuggestion`, `ReceiptUpload`, `Notification`, `NotificationJob`, `NotificationPreference`, `SnoozedEvent`, `ValueEvent`, `DataDeletionJob`. **Not moving:** Bill*, FxRate (collisions above), BillingAccount/WebhookEvent (Stripe shell dies), EmailMessage etc. (already deleted). One migration; verify: `prisma validate` + vitest + build.

**γ — Code move** · `sonnet-5 @ high`, one chip per slice if large
Move: `src/lib/security/` wholesale · gmail/imap services + parsers · scan/reprocess/suggestions/detected routes · returns domain + routes + Returns board UI · purchases inbox + receipts UI · digest scheduler + notification schedulers + cron routes · settings (automation, notifications, privacy/export/delete). New in MoneyTalks: **`vercel.json` cron entries for digest + notify** (return-saas never had them — its digests literally never fired; absorption fixes this). Suggestion-confirm for BILL type rewires to Money Core bills (collision table). Verify: vitest (absorbed security tests + new route smokes), build, manual scan.

**δ — Post-move hardening** · `sonnet-5 @ high`
The three correctness debts that shouldn't survive absorption: a real `canTransition()` return-status machine replacing the 8 inconsistent write sites (unit-tested); fix-or-delete the broken Gmail `reprocess` path (envelope-vs-Gmail message-id mismatch); **attachment storage → Vercel Blob** (filesystem writes are fatal on Vercel — mandatory now, not optional); "Estimated" labels on the simulated shipment timeline (honesty rule). Verify: state-machine unit tests + build.

**ε — Cutover & decommission** *(mostly you, checklist + small script chipped at `sonnet-5 @ medium`)*
Env into MoneyTalks Vercel: Clerk (same app), `SECRET_ENC_*` (fresh V1 fine — re-ingest re-encrypts), `GOOGLE_*` with **new redirect URI added in Google Cloud console**, Resend, `CRON_SECRET`. Reconnect Gmail/IMAP, 90-day rescan; import keepers (returns history, value events) from `looply-export.json` via a one-off script. Parity checklist green → pause Looply Vercel project, snapshot its DB (keep 30 days), then delete. Drop Auth.js tables.

## Success means
One deployed app: Clerk login; Gmail connect + scan with encrypted credentials; returns/purchases/subscriptions/digest live inside MoneyTalks with crons actually firing; Looply prod off; both repos' suites green. return-saas repo goes read-only/archive after ε.

## Out of scope (unchanged)
TS card-engine twin · real carrier APIs · multi-user launch polish · bank aggregation · paid tiers · any new surface not listed in γ.
