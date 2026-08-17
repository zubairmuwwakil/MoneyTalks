# Phase 4 — Brand, compliance, TestFlight

**Status:** Approved 2026-08-16 (forks ratified: D1 PickMe provisional · D2 TestFlight+waitlist · D3 ten cards+request flow).
**Parent:** decision record D1–D3, A1 (compliance rewrite mandate), A5 (UI split).
**Gates:** external-tester invites wait for the Phase-3 dogfood week's fired/suppressed/coverage numbers · public (Phase 5) launch waits for CIPO clearance + Google OAuth verification decision.

## Chunks

**4a — Brand application** · `sonnet-5 @ medium`
iOS: display name "PickMe" (bundle id stays `ca.pickme.cardcopilot`), notification sender therefore reads "PickMe: …". Web hub: title/nav/mail-from naming pass ("PickMe" consumer brand; "MoneyTalks" survives only as internal repo name). No logo/icon work in this chunk (owner supplies or iterates separately; placeholder acceptable for TestFlight). Verify: builds green, grep for stray user-facing "MoneyTalks"/"Card Copilot"/"Looply" strings in UI surfaces.

**4b-docs — Compliance rewrite** · `opus-5 @ high` (judgment writing; match the quality bar of the existing docs/compliance corpus)
Rewrite PickMe's `docs/compliance/` for the ambient product per A1/C2: privacy policy (purchase-time location, geofence arrival detection, server-side parsing of the user's own email, Clerk auth, Vercel/Neon/Blob processors, retention incl. coordinate reduction, no bank credentials, nothing sold); App Store privacy-label worksheet redone truthfully (identifiers, purchases, coarse+precise location, email-derived content — linked to user); App Review notes (Guideline 4.2 substance argument: ambient loop + wallet health + benefits reference + verified feedback); TestFlight beta-review notes; data-deletion disclosure. Keep the counsel-notes style of the originals. FRENCH: produce FR versions of user-facing policy + App Store metadata, marked "machine-drafted — human legal review required before public launch" (Law 25).

**4b-code — Account deletion path** · `sonnet-5 @ medium`
iOS settings: delete-account flow → calls the absorbed data-deletion endpoint + Clerk user deletion; confirmation with consequence copy; works for TestFlight reviewers (Apple 5.1.1(v)). Web parity check (the moved privacy surface already covers export/delete — verify + wire Clerk deletion). Verify: vitest + manual flow.

**4c — French localization (app)** · `sonnet-5 @ high`
iOS String Catalogs for all user-facing strings (screens, notifications, permission explainers — the pre-permission location screen especially). Notification copy length-checked in FR (lock-screen truncation). Mark for human review: legalish strings. Verify: build with fr-CA locale, screenshot pass described in report.

**4d — Waitlist + card-request flows** · `sonnet-5 @ medium`
Web: public waitlist page (email capture → table + notify), signup stays allowlisted; promoting a waitlister = allowlist add (document the manual step). iOS + web: "request your card" — picker of issuer/card free-text → CardRequest table → visible tally for the owner (demand-driven expansion per D3). Verify: vitest, build.

**4e — Tester onboarding: wallet picker** · `sonnet-5 @ high` — **the biggest product gap for any non-owner user**
iOS first-run: choose your cards from the 10-card catalogue, set per-card conditions (the three ownerConditions), default card, switch threshold (sensible default 0.5pp/$0.25), point valuations prefilled from published benchmarks with the honesty disclosure. Produces a real per-user OwnerState (local + synced to the server record 3b seeded). Card-request entry point when their card isn't listed. Verify: `swift test` (OwnerState construction pure logic), fresh-install manual flow.

**4f — TestFlight package** · owner + `sonnet-5 @ medium` support
Owner: Apple Developer enrollment decision (individual is fine for TestFlight; org/D-U-N-S can wait for Phase 5), App Store Connect app creation, archive upload, external-testing group + invites (post-dogfood-week). Chip support: build settings audit (versioning, export compliance keys — `ITSAppUsesNonExemptEncryption` already set), beta metadata text from 4b-docs, a TESTFLIGHT.md runbook of the exact owner steps. Verify: archive builds clean locally.

## Sequence

4a → 4b-docs ∥ 4b-code → 4c → 4d ∥ 4e → 4f. (4e before invites; 4b-docs before any reviewer sees the app.)

## Out of scope (Phase 5)

Public App Store submission · Google restricted-scope verification · catalogue expansion beyond requests · pricing · org enrollment/trademark filing (CIPO *search* is owner-todo now; *filing* is Phase 5).
