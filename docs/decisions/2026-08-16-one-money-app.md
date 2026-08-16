# Decision Record — One Money App

**Status:** Ratified 2026-08-16 (Zubair). Treat like orc `SPEC.md` §2: **do not relitigate these in implementation sessions** — build against them, and flag concerns in a report/PR instead. Each closed fork lists the one condition that would legitimately reopen it.
**Evidence basis:** the "One Money App" review artifact (claude.ai/code/artifact/081707fc-446a-4217-b2e3-906d80946c3a) + four deep-dive code reviews of 2026-08-16.
**Scope:** `MoneyTalks`, `PickMe`, `return-saas`. Canonical copy lives here (MoneyTalks is the web hub); each repo's `CLAUDE.md` points at it.

---

## Decisions

1. **Product shape: unified product, separated modules.** One brand, one purchase spine, two clients (native iOS checkout + web money hub). Explicitly rejected: one merged codebase (kills the native checkout moat) and three standalone products (guarantees card-logic drift, triples ops).

2. **Card semantics have exactly one owner: the PickMe engine.** Effective immediately, **MoneyTalks' card engine is frozen** — no new rule-model features, no new categories, no picker changes (`baseRateOverrides` was the last). Bug fixes only until it is deleted in Phase 1. *Why:* in one three-day window MoneyTalks re-implemented conditional rates PickMe already had; two engines can already disagree on the same purchase.

3. **Card *data* is a shared, versioned JSON contract.** `card-catalogue.json` + owner state + `engine-fixtures.json` (the language-neutral conformance suite) become a shared package. No engine hard-codes card facts; any second implementation must pass the same fixtures. Fixtures are the cross-language truth, not code review.

4. **Auth: Clerk** *(fork closed).* return-saas already enforces it across 43 routes; managed auth is the right risk posture for a honeypot-class app; MoneyTalks' Auth.js surface is ~20 LOC to migrate and Clerk supports passkeys. **Reopen only if:** Clerk pricing becomes material before revenue does.

5. **return-saas is absorbed, not rehabilitated** *(fork closed).* Three pieces move into the web hub: email/receipt ingestion, returns/refunds domain, and the digest job queue (its best code). The standalone SaaS shell — pricing page, Stripe tiers, "Looply" branding, marketing pages — is retired. The 2026-08-16 security hardening was an investment in the absorbed component, not the standalone product. **Reopen only if:** Looply gets real external users before Phase 1 lands.

6. **The wedge is the checkout card pick** *(fork closed).* v1 surface = card recommendation + wallet + post-purchase catch-net (returns/trials/refunds digest). Net worth, investments, bank aggregation, benefits finder, paid tiers: **out of v1**. The tax/cross-border rules engine stays as a seasonal differentiator, not the front door. **Reopen only if:** real users engage the compliance engine harder than the card pick.

7. **iOS stays native** *(fork closed).* The zero-network, offline checkout is a strategic asset (speed + privacy posture). Cost accepted: the Swift engine and an eventual TS twin are both held to decision 3's fixtures. **Reopen only if:** solo maintenance of two languages measurably stalls the wedge.

8. **One purchase spine.** A single Purchase record every stage enriches — created at checkout (card, predicted value), enriched by ingestion (receipt, return window), consumed by Money Core (what it actually cost). return-saas's `Purchase` model is the seed. In-process events with the `PurchaseCompleted` vocabulary; **no broker, no event infrastructure** for one process.

9. **Don't do** (standing list): no Swift→TS port until a second consumer actually needs it · no bank aggregation, paid tiers, or investment tracking on the path to the wedge · no further work on return-saas's SaaS shell or its January duplicate trees except deletion · no event broker.

10. **Process:** migration tasks that have a mechanical verifier (fixtures pass, build green, dead code gone) run through **orc**; judgment tasks don't. No card work merges anywhere without green golden fixtures in CI.

---

## Immediate consequences

- **MoneyTalks:** card engine frozen (decision 2). Next card-related work is *consuming* the shared catalogue, not extending the picker.
- **PickMe:** fix the red `BenefitsLoaderTests` (stale stub assertion vs. the new benefits catalogue) and add a CI gate — the last unfinished Phase 0 item. `PortfolioAnalyzer` (built, tested, no UI) is the designated keep/cancel authority and gets promoted to a surface in Phase 1.
- **return-saas:** no new SaaS-shell features. Next work here is absorption prep: delete dead module trees/models, keep ingestion + returns + job queue healthy.
- **Phase 0 status:** security items shipped 2026-08-16 (`b2c798b`): credential encryption at rest, OAuth `state`, cron fail-closed, Stripe/Clerk matcher. Remaining: PickMe red test + fixture CI.

## Deferred, deliberately (cheap to decide later, in order of likely arrival)

Monorepo mechanics and timing · consumer brand name · TS twin of the card engine · pricing/packaging. *(Clerk migration and honesty labels shipped in Phase 2.)*

---

# Amendment A — Ambient copilot revision (ratified 2026-08-16)

The wedge's delivery mechanism changes from "open app → pick card" to an ambient loop: recommend before purchase without opening the app, capture the purchase passively, verify the choice, and feed the result back. Amends decisions 6 and 7; adds A1–A6.

- **A1 (amends 7 — network posture).** PickMe's "zero network calls" guarantee is retired, deliberately. Replacement posture, in order: *recommendations computed on-device · no bank credentials ever (no Plaid/Flinks — reaffirmed) · email parsed only by the user's own account's pipeline · nothing sold.* App Store privacy labels and `docs/compliance/` must be rewritten to match before any public release (Phase 4 item). On-device recommendation must keep working with no connectivity.
- **A2 (amends 6 — wedge mechanism).** v1 ambient = **geofence-triggered local notifications** (no server dependency): CLMonitor regions over the nearest ~20 merchants, re-registered on significant location change. Push-to-start Live Activities are v2, via the now-existing backend. v1 merchant scope is the owner's top-visited set (dogfood-first — ratified).
- **A3 (new — the firing rule).** Ambient notifications fire only when ALL hold: merchant confidence high (truth graph) ∧ recommended card ≠ user's default ∧ advantage clears the switch threshold ∧ merchant not muted. Silence is the default state; post-purchase ✓/⚠ feedback carries retention, not pre-purchase pings.
- **A4 (new — capture paths).** Apple Pay: iOS Shortcuts "Transaction" automation → App Intent → local store → spine sync (accepted platform risk: per-card setup, Apple may change it; FinanceKit remains closed for Canada). Online: the absorbed email ingestion. Physical swipe/insert gap is measured, not promised away: statement-CSV reconciliation is the coverage instrument.
- **A5 (new — UI split).** iOS stays a single-responsibility control centre (wallet, valuations, feedback log, one value-recovered figure + a small monthly summary). Deep analytics/visualization lives on the web hub only. No dashboard duplication in Swift.
- **A6 (new — honesty invariant).** The feedback loop inherits the measurement discipline unchanged: estimates labeled, misses attributed honestly (including "we recommended wrong"), eligibility-gated metrics, `nil` over flattery. Roadmap note (not v1): card-*acquisition* recommendations via PortfolioAnalyzer's counterfactual run in reverse (add-a-card marginal value) — the question affiliate sites can't answer honestly.
