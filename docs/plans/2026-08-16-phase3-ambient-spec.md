# Phase 3 — Ambient loop & the real purchase spine

**Status:** Approved 2026-08-16 (design ratified in chat; Amendment A to the decision record is binding).
**Parent decisions:** `../decisions/2026-08-16-one-money-app.md` incl. Amendment A (A1–A6).
**Goal:** the loop runs without opening the app — geofenced recommendation → purchase → passive capture (Wallet Shortcut + email) → verified ✓/⚠ feedback → real cap usage flowing back into the checkout engine.
**Precondition:** Phase 2 ε cutover complete (MoneyTalks deployed with absorbed stack; Looply decommissioned). Chunks 3a/3d are server+iOS; do not start before cutover.

## Design facts the chunks rely on

- **Live Activities cannot self-start from background location.** v1 ambient = region-enter → brief background wake → **time-sensitive local notification**. Push-to-start Live Activities = v2 (server exists now).
- **20-region OS limit** → maintain a rotation: on significant location change, re-register CLMonitor regions for the ~20 nearest known merchants (reuse `MerchantProvider` ranking). Owner's top-visited set first (A2).
- **The notification cannot preselect the card in Wallet.** Copy must say "use X", never imply automation.
- **Wallet capture** = per-card Shortcuts "Transaction" automation invoking an App Intent with {merchant string, amount, card}. Guided setup screen required. FinanceKit is closed for Canada; this is the only path.
- **Engine unchanged in semantics:** real cap data arrives as `OwnerState.capProgress` — the engine already consumes it; Phase 3 replaces the static seeded numbers with synced truth. No card-contract version bump.
- **Identity on iOS:** PickMe gains Clerk (same application). Sync is authenticated per-user against the MoneyTalks API.

## Chunks (sequence: 3a → 3b → 3c on iOS; 3d server-side parallel after 3a; 3e last)

**3a — Spine sync API + iOS client** · server `sonnet-5 @ high`, iOS `sonnet-5 @ high`
MoneyTalks API routes (Clerk-authed): `POST /api/spine/purchase-events` (idempotent by client-generated event id; source WALLET|EMAIL|MANUAL), `GET /api/spine/caps` (per-card capId → usedMinor for the current periods), `GET /api/spine/feedback` (recent verified outcomes). PickMe: Clerk iOS sign-in, thin API client, offline queue (store-and-forward — recommendations must never block on network, A1). Verify: vitest route tests (idempotency asserted) + `swift test` + manual round-trip.

**3b — Wallet capture + verified feedback** · `sonnet-5 @ high`
App Intent receives the Shortcut payload → normalize merchant via truth graph → match against the recommendation log (was there a prediction for this merchant/time?) → run the existing arithmetic-verdict machinery → local notification: "✓ Best card used · $18.47 at Starbucks · ~$1.56 value" or "⚠ Cobalt would have earned ~$0.74 more" (estimates labeled, A6) → enqueue spine event. Guided per-card automation setup screen with paste-ready shortcut. Verify: `swift test` for mapping/verdict integration; scripted manual capture test.

**3c — Geofenced ambient recommendations** · `sonnet-5 @ high`
Region rotation service (significant-change driven, battery budget documented); on region-enter: resolve merchant → run engine on-device → **A3 conjunctive gate** (confidence ∧ differs-from-default ∧ clears switch threshold ∧ not muted) → time-sensitive local notification with card + reason. Per-merchant mute from the notification. The gate is a pure function in Engine/ with exhaustive unit tests (each conjunct independently flipped). Verify: `swift test` incl. gate matrix; a week of owner field-testing is the real acceptance — instrument fired/suppressed counts locally.

**3d — Email purchases join the spine + cap ledger** · `sonnet-5 @ high`
Server-side: ingested purchases (email) and wallet events map to {card, category, amountMinor} → accrue into a `CapUsage` ledger keyed by the card contract's capIds and periods (calendarMonth first; accountYear needs the anchor — read it from owner state, implementing what the schema declared, and note it in the contract's x-status). `GET /api/spine/caps` serves the ledger; iOS merges into `OwnerState.capProgress` on sync. This kills the "5× MR" ping when a cap is exhausted. Verify: vitest accrual tests (period boundaries, multi-rule shared caps) + one new engine fixture exercising synced cap data end-to-end.

**3e — Coverage instrument** · `sonnet-5 @ medium`
Statement CSV import (existing MoneyTalks machinery) reconciles statement lines against captured spine events: match rate = the coverage metric; unmatched lines offer one-tap backfill as MANUAL purchases. Monthly "capture coverage: N%" on the web hub. Verify: vitest matching tests with fixture CSVs.

## Out of scope (Phase 4+ or conditional)

Live Activities push-to-start · App Store privacy-label/compliance rewrite (Phase 4, required by A1 before release) · card-acquisition recommendations (A6 roadmap) · real carrier tracking · Plaid/Flinks (never) · public merchant catalogue beyond the dogfood set.

**Done means:** a week of real use where the phone recommends at arrival, captures the tap, and the ✓/⚠ arrives without the app being opened once — with fired/suppressed/coverage numbers to judge it by, not vibes.
