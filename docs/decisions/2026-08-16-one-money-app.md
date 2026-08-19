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
- **B1 (amends 5 / Phase-2 ε — Looply deployment).** The Looply deployment is NOT decommissioned; it stays live indefinitely as a **portfolio demo** (recruiter-facing), explicitly not a product: no feature work, no users solicited, no data import needed (owner confirmed nothing to migrate). Containment: Google OAuth app stays in testing mode; Stripe stays in test mode; its (old) Clerk app remains dedicated to it and is never used by the unified product. Everything else in decision 5 stands — the code was absorbed, the repo gets no SaaS-shell work, and the *product* is the unified app.
- **C1 (amends 9 — TS twin authorized, 2026-08-16).** Server-side verdicts for Wallet capture are the "second consumer"; the **TypeScript twin of the scoring core** (RuleMatcher, CapMath, Scorer, recommend — nothing else) is now authorized, living in the MoneyTalks backend, **gated by the shared fixture suite running in both languages in CI** — any Swift/TS divergence fails the build. Swift remains canonical; contract changes land in Swift + fixtures first.
- **C2 (new — capture reliability invariant).** All ingestion obeys: *capture first, persist second, enrich third, upload when possible, process server-side; never lose a purchase because enrichment or networking failed.* Wallet events are **observations, not transactions** (state: observed → normalized / possibleDuplicate / reconciled / reversed); raw values are never overwritten; currency is captured, never guessed; `capturedAt` is never replaced by upload time. v1 verdict delivery: computed synchronously, returned in the POST response, notification shown **only for ⚠** (A3-consistent); APNs push is v2. Full spec: `../plans/2026-08-16-wallet-capture-spec.md`.
- **D1 (Phase 4 — brand, PROVISIONAL).** Consumer brand = **PickMe** (compound App Store listing name, e.g. "PickMe: Card Copilot", for ASO differentiation from the ride-hail apps and Connect name-uniqueness). Set provisionally — rename stays cheap until public App Store launch, at which point this hardens. **Before public (post-TestFlight) launch:** direct CIPO search clean in Nice classes 9/36/42 (owner). Known accepted costs: ASO drag vs existing PickMe transport apps; "pick-me" meme adjacency. US signal favorable (LG's PICK ME mobile-software registration is cancelled). Repos keep their working names.
- **D2 (Phase 4 — launch shape).** TestFlight external testing + manual waitlist for the web hub; full App Store submission is Phase 5, informed by tester data. Google restricted-scope OAuth verification explicitly deferred (testing-mode caps suffice at this scale). External-tester invites gate on the Phase-3 dogfood week's numbers.
- **D3 (Phase 4 — catalogue).** Launch with the 10 sourced-and-verified cards + an in-app "request your card" flow; expansion is demand-driven and holds the issuer-confirmed sourcing bar. No open card editor (quality moat).
- **A6 (new — honesty invariant).** The feedback loop inherits the measurement discipline unchanged: estimates labeled, misses attributed honestly (including "we recommended wrong"), eligibility-gated metrics, `nil` over flattery. Roadmap note (not v1): card-*acquisition* recommendations via PortfolioAnalyzer's counterfactual run in reverse (add-a-card marginal value) — the question affiliate sites can't answer honestly.

---

# Amendment E — Four-product ecosystem (ratified 2026-08-18)

Scope widens from three repos to four: `marketdata`/MarketLens joins
`MoneyTalks`, `PickMe`, `return-saas`. Amends decisions 1, 6, 9 and D1; adds E1–E5.

- **E1 (supersedes D1 — brand).** The consumer brand is **not** PickMe. The
  unifier takes a **new consumer name**; PickMe, Looply, and MarketLens keep
  their own identities as distinct products. D1's compound-App-Store-listing
  rationale ("PickMe: Card Copilot", ASO differentiation from the ride-hail apps)
  is retired along with its accepted costs. *Why:* the four-sensor story is a
  deliberate product and portfolio asset; collapsing it under one existing
  sub-product's name destroys the narrative and mis-sizes the unifier. **Knock-on:**
  D1's CIPO Nice 9/36/42 clearance transfers to the new name and must clear before
  public launch; D2's TestFlight/waitlist copy and D3's catalogue framing update
  once the name is chosen. Rename stays cheap until public App Store launch.
  **RESOLVED 2026-08-18: the name is Inunity**, domain `inunity.ca` purchased.
  Note for clearance: an unrelated software company (inunity.com — Textline,
  Texting Base, Textedly) holds the name in classes 9/42; class 36 appears open.
  The CIPO 9/36/42 search is still owner work and now has a known obstacle.

- **E2 (amends 6 and 9 — investments enter v1).** Investment tracking is **in v1**,
  sourced from MarketLens. *Why:* seeing investments tracked is a core reason the
  command center is worth opening, and it does **not** require real-time data —
  daily/latest pricing suffices, which is exactly the line between MarketLens and
  what the unifier needs. Decision 6's "investments out of v1" and decision 9's
  "no investment tracking on the path to the wedge" are amended to this extent
  **only**. Still out: net worth, cash-flow forecasting, bank aggregation, paid
  tiers. Decision 9's remaining "don't do" list stands unchanged.

- **E3 (new — MarketLens in scope).** `marketdata` is the fourth scoped repo and the
  single owner of market data and investment analytics (OHLCV, indicators,
  corporate actions, calendar, quality). **The unifier consumes MarketLens and
  never re-implements market data.** MarketLens does not grow personal-finance
  features — it does not own purchases, cards, or the complete financial picture.
  It gets its first `CLAUDE.md` and is bound by this record from today.
  Describe its pricing as **daily/latest, never real-time**, unless the
  infrastructure changes (honesty invariant, A6).

- **E4 (new — Yahoo provider inside MarketLens).** MarketLens gains a
  Yahoo-sourced `YahooDailyProvider` implementing the existing
  `MarketDataProvider` interface (`fetchDailyCandles` + `sourceName`), alongside
  `AlphaVantageDailyProvider`. *Why:* Alpha Vantage's free tier cannot serve
  arbitrary per-user holdings; Yahoo's effective headroom can. Placed **inside**
  MarketLens rather than called directly from the unifier, so market data keeps
  exactly one owner — the same failure decision 2 was written against, after
  MoneyTalks re-implemented conditional card rates PickMe already had within one
  three-day window. Per-candle provenance rides the existing `sourceName()`.
  - **Accepted risks, recorded not hidden (A6):** Yahoo's terms do not sanction
    this access; the endpoints break periodically (the 2023 cookie/crumb change
    broke every wrapper for weeks). Accepted at this scale, revisit before any
    paid tier or material user growth.
  - **Invariant:** portfolio valuation **never hard-depends on a live fetch**.
    Cache last-known price, label staleness, fail closed rather than fabricate a
    number — the same rule as the FX cron of 2026-08-18, where an empty fetch
    returns 502 and leaves existing rates untouched.
  - **Deferred, named:** MarketLens needs a latest-quote path for a *dynamic*
    per-user holdings set; its model today is fixed-watchlist daily ingestion.
    Design item, not decided here.

- **E5 (new — document precedence).** Three document layers, one order:
  `LOG.md` > this record > `ECOSYSTEM.md`/`ECOSYSTEM-NARRATIVE.md` — **except**
  the ecosystem docs win on *identity* (names, brands, capability ownership, the
  story). The narrative authorizes **no work**; its feature lists are positioning,
  and horizon buckets in `ECOSYSTEM.md` govern what may be proposed. On any
  conflict outside identity: **stop and ask. Do not average the documents.**
  `ECOSYSTEM.md` is mirrored into all four repos and carries a sync stamp;
  edit the canonical MoneyTalks copy and run `scripts/sync-ecosystem.sh`.

## Consequences of Amendment E

- **MoneyTalks:** is Inunity, the unifier. Investment tracking is now
  buildable, consuming MarketLens. Everything else in decision 6's v1 surface
  stands.
- **PickMe:** unchanged as the canonical card engine; it is no longer the
  consumer brand of the whole product.
- **return-saas:** unchanged (B1 — portfolio demo, no feature work). Its
  `CLAUDE.md` clarifies that "Looply" is the retired product name while the
  email-intelligence capability now lives in the hub.
- **marketdata:** enters the system. First `CLAUDE.md`, bound by this record,
  `YahooDailyProvider` authorized per E4.
