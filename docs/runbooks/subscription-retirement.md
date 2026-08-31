# Legacy subscription retirement gate

**Status:** Phase 6 prepared, not approved and not applied.

The contract SQL is staged at
`prisma/retirement/2026-08-30-retire-legacy-subscriptions.sql`. It is outside
`prisma/migrations` on purpose, so an ordinary release migration cannot execute
the irreversible drop. Do not move it into that directory until the owner
separately approves Phase 6.

## Evidence required

Run the retirement only when all of the following are true for the complete
one-release observation window:

1. `subscription.compatibility_adapter.requests` is exactly zero for every
   route, method, and caller class. Elapsed time without this
   measurement is not evidence.
2. The §13 inventory is fully cut over. The guard must report no live legacy
   writes, reads, endpoint consumers, or lossy projection consumers; no
   notification may retain `sourceKind = subscription`; and the compatibility
   routes and resolver must be removable without changing an internal caller.
3. Subscription-filtered canonical readers see every intended subscription.
   This is currently **blocked**: the read-only production snapshot on
   2026-08-30 found 3 `RecurringObligation` rows and all 3 had `kind = null`
   (1 `ACTIVE`, 2 `LAPSED`). No classification change is authorized by this
   task.
4. `subscription.migration.notifications` shows a `scan-batch` for every cron
   batch plus successful canonical scans and schedules with no unexplained
   failures; `subscription.migration.data_operations`
   contains successful export and deletion exercises; and immediate repeat
   sweeps are represented by `subscription.migration.sweep_outcomes` as
   `completed` and `unchanged`, without unexpected new creates or updates.
5. A fresh read-only preflight again proves `Subscription = 0`,
   `SubscriptionPayment = 0`, and `LegacySubscriptionMapping = 0`, and the SQL
   draft's own preconditions pass. The 2026-08-30 snapshot proved all three
   were zero, but that snapshot is not permission to drop later.
6. A restorable production backup has been created and restoration has been
   verified, not merely requested or reported as started.

## Current §13 inventory audit

| Surface | Phase 5 finding |
|---|---|
| Renewal/trial events | Reads `RecurringObligation` and owner facts. Blocked operationally by the current `kind = null` rows. |
| Renewal scheduling and notify cron | Reads `RecurringObligation`; new notifications use `sourceKind = recurring-obligation`. Instrumented for scanned, scheduled, and failed outcomes. |
| Value-at-risk | Reads `RecurringObligation` and its canonical schedule/status. Blocked operationally by `kind = null`. |
| Subscription transaction history | Reads canonical `CHARGE` owner facts; the legacy map is only an ID bridge during the window. |
| Automation suggestion confirmation | Creates an owner `RecurringObligation` and canonical notification. The retired detected-item confirmation endpoint does not translate writes. |
| `/subscriptions` and inline edits | Reads and writes the canonical model. Blocked operationally by `kind = null`. |
| Notification links and sources | New sources are canonical. The UI still resolves historical `sourceKind = subscription` until the Phase 6 preflight proves none remain. |
| Export, deletion, summary, privacy counts | Canonical rows/facts are included. Export and deletion deliberately retain frozen legacy material during the rollback window; both now emit outcome counters. Summary counts canonical rows/facts. |
| User relations and Prisma types | Legacy declarations remain solely because Phase 6 is unapplied. Their removal belongs in the separately approved schema-clean change. |
| Tests, fixtures, guardrails | The guard rejects live legacy writes, reads, compatibility endpoint consumers, and lossy projection consumers. Compatibility tests require deprecation headers and `lifecycleStatus`. |

This audit distinguishes “the reader uses the canonical table” from “the
reader currently sees every intended subscription.” The former is complete;
the production classification blocker means the latter is not.

## Approved execution sequence

Use separate releases so the currently deployed application never depends on
a table that has already been removed:

1. Remove compatibility routes, the legacy notification resolver, legacy
   export/delete branches, and every other runtime reference; deploy that
   non-destructive application cutover while the old tables still exist.
2. Re-run the evidence gates and read-only preflight. Obtain the separate owner
   approval and verified backup.
3. Move the staged SQL into a newly timestamped `prisma/migrations/.../migration.sql`
   directory, remove the legacy Prisma models, relations, and enums in the same
   approved change, then run `npm run db:migrate:deploy` as the owner-controlled
   release step before building the schema-clean application.

Never run the draft directly against production, and never add migrations back
to `npm run build`.
