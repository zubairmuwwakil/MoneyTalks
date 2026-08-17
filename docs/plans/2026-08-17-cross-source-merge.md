# Cross-source purchase merge — design

**Problem.** One real purchase produces up to three observations: a Wallet tap (seconds), an email receipt (minutes–hours), a statement line (weeks). Before this design, Wallet and Gmail each created their own `Purchase` row — the user would see the same coffee twice — and each accrued reward caps under a different key (`wallet:{eventId}` vs `purchase:{purchaseId}`), double-counting the same dollars.

**Model.** The raw landing tables (`WalletEvent`, `EmailTransaction`) ARE the observations; no new abstraction. Each gains a `purchaseId` link to the canonical `Purchase`. `Purchase.source` remains whichever source observed it first; provenance = the set of linked observations. `Purchase.possibleDuplicateOfId` (plain column, no FK) flags conservative near-matches for the UI.

**Matching** (`src/lib/domain/spine/purchaseMerge.ts`), evaluated when promoting an observation, against purchases of *other* sources only (same-source dedup is already handled by unique keys + the wallet fuzzy-dup check), skipping candidates that already consumed an observation of the incoming type:

- amount equal (minor units) AND within 72h AND merchant compatible (canonicalized equality or containment) → **exact**: attach + enrich, no new row.
- amount equal AND within 72h, merchant unclear → **possible**: create own row, set `possibleDuplicateOfId`. Never silently merge on amount+time alone.
- otherwise → unrelated: create own row.

**Enrichment on exact merge** — never overwrite non-null, with one exception: a Wallet tap's `capturedAt` becomes `purchasedAt` (the tap is the authoritative instant). Email contributes `orderNumber` + line items; Wallet contributes card + category.

**Cap accrual** — exactly once per real purchase: every accrual is keyed `purchase:{canonicalPurchaseId}`; `CapAccrual.sourceKey` uniqueness makes whichever source resolves first win and blocks the second. Reversal tries the canonical key, then falls back to the legacy `wallet:{eventId}` key for pre-merge history.

**Migration** backfills `purchaseId` links for existing rows from the old `sourceEventId`/`sourceEmailId` columns.

**Deferred:** statement lines as a third observation source (reconcile flow currently compares in-memory only); a UI to confirm/split `possibleDuplicateOf` pairs; fuzzy amount matching (tips change totals between receipt and statement).
