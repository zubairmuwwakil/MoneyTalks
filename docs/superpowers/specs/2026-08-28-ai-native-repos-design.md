# AI-native repo architecture — "compile to delete"

**Date:** 2026-08-28
**Scope:** All six owner repos — MoneyTalks, marketdata, PickMe, return-saas,
agent-orchestrator, pickleball-session-manager.
**Status:** Ratified. M0/M1/M2/M4/M6 complete; M3/M5 pending.
**Decomposition:** Larger than one implementation plan. Each milestone in §5 gets
its **own** plan. Milestone 1 (MoneyTalks) proves the pattern and its outcome may
revise this spec before milestone 2 is planned.

---

## 1. Problem

Every repo carries agent-facing instruction files, mostly written as post-mortems
after something broke. Measured cost and coverage today:

| Repo | Always-loaded | Invariants stated | Enforced | AGENTS.md | Local skills |
|---|---|---|---|---|---|
| pickleball-session-manager | ~3,024 tok | many | ~30 checks, 20 self-tested | 26 lines | 0 |
| marketdata | ~2,385 tok | ~15 | ~2 | **missing** | 0 |
| MoneyTalks | ~2,285 tok | ~15 | 2 | **boilerplate only** | 0 |
| return-saas | ~1,157 tok | ~6 | 0 | **missing** | 0 |
| PickMe | ~1,097 tok | ~5 | CI gate only | **missing** | 0 |
| agent-orchestrator | ~782 tok | ~8 | 0 (no CI) | **missing** | 0 |

The owner reports three frictions — **ceremony before real work**, **agent
timidity / over-asking**, **context bloat** — and explicitly *not* "rules get
ignored." Compliance is not the problem. The cost is on the input side.

### Gaps found during design (16)

| # | Gap |
|---|---|
| G1 | `AGENTS.md` missing in 4 repos; MoneyTalks' is 100% Next.js boilerplate. Codex/Gemini/Copilot read `AGENTS.md`, so ecosystem rules are invisible to 3 of 4 vendors. |
| G2 | No `typecheck` script in MoneyTalks / return-saas. `tsc --noEmit` passes clean — free to add. |
| G3 | MoneyTalks `main` is red: 2 `react-hooks/preserve-manual-memoization` errors in `src/app/bills/new/page.tsx`. Unit tests are green (1,141 in 3.7s). |
| G4 | PickMe CI red 4 consecutive runs while its `CLAUDE.md` says "Keep it green." |
| G5 | `ECOSYSTEM.md` mirrors drifted **on identity** — canonical "In Unity" vs mirrors "Inunity" — the one thing that file claims final authority over. |
| G6 | The stamp mechanism is fictional. `sync-ecosystem.sh` greps for `ecosystem-sync: <hash> <date>`; that token exists in no copy. |
| G7 | `sync-ecosystem.sh --check` works, exits non-zero when stale, runs in no CI — and can't as written (needs sibling repos on disk). |
| G8 | PSM Quality Gates last ran 2026-07-20 and failed. Five weeks ungated. |
| G9 | agent-orchestrator's definition of done holds (11 tests, ruff, mypy all clean) but has no CI to keep it that way. |
| G10 | Feedback loop is excellent where it exists — 1,141 tests in 3.7s. Adding checks is nearly free. |
| G11 | 7 Playwright e2e specs exist in MoneyTalks and never run in CI. |
| G12 | Zero dependency automation and zero security scanning across all six repos; five are public. |
| G13 | Two competing plan directories: `docs/plans/` (6) and `docs/superpowers/plans/` (10). |
| G14 | `scripts/` is a flat 19-file drawer with duplicates (`check-db.mjs` + `.ts`) and scratch (`check-ml.mjs`, `check-ml2.mjs`). |
| G15 | e2e cannot join a fast tier: spawns `npm run dev`, needs Postgres, real Clerk dev-instance round-trips, `workers: 1`, 60s timeouts. |
| G16 | MoneyTalks cannot be cold-started from its own docs. `.env.example` omits 6 live vars including **`MARKETLENS_API_KEY`** and **`MARKETLENS_BASE_URL`** — the E3/E4 boundary's own configuration. |
| G17 | Local work was not pushed, so CI graded stale code: PickMe 17 commits ahead, MoneyTalks 3, PSM 3. PickMe's iOS failure was fixed 17 commits ago; PSM's gates "last ran 2026-07-20" because nothing had been pushed since. Resolved 2026-08-28. |

## 2. Diagnosis

Rules sit on an enforcement ladder, cheapest-for-the-agent first:

1. **Types / schema** — cannot be expressed wrongly
2. **Test / CI check** — fails loudly in seconds
3. **Lint rule / grep guard** — cheap and local
4. **On-demand prose** — loaded only when the work touches the topic
5. **Always-loaded prose** — costs tokens every turn, enforced by hope

MoneyTalks and marketdata put nearly everything on rung 5. PSM pushed rules to
rungs 2–3 at scale **and** is the most context-expensive of the six, because it
kept the prose too.

**The second, deeper failure: enforcement without a trigger.** G4–G8 are one
pattern. `sync-ecosystem.sh --check` is correct code that runs nowhere. PSM's 30
checks haven't gated a commit in five weeks. PickMe's "keep it green" has no
watcher. The stamp was implemented in the script and never added to the file.
Branch protection is enabled on all four inspected repos with **zero required
status checks** — CI turns red and nothing stops a push.

A check without a trigger is prose with extra steps, and worse than obvious
prose: it *feels* enforced.

Two mechanical findings:

- **`@file` in an instruction file is an eager import.** A session opened in
  MoneyTalks has `ECOSYSTEM.md` and `AGENTS.md` inlined into its system prompt.
  Demotion is only real via a **markdown link**.
- **Guardrails that break silently are worse than none.** PSM already solves
  this: 20 of ~30 checks have their own test.

## 3. Principles

**P1 — Compile to delete.** A check is where a rule goes *so it can stop being
said*. The MoneyTalks quote-cache invariant costs ~600 tok/turn as prose and 0
as `scripts/qstash-schedules.config.test.ts`.

**P2 — Compile or demote; nothing uncompiled stays always-loaded.** What cannot
become a check moves to a linked policy file or skill. Nothing is lost; nothing
uncompiled pays per-turn rent.

**P3 — A fact has exactly one owner.** Already enforced for card semantics and
market data. It applies to agent configuration too.

**P4 — No check ships without a trigger.** A check and its CI wiring land in the
same change. A check that runs nowhere is not done.

**P5 — Always-load the trigger, demote the procedure.** A proactive obligation
only fires if the agent is prompted to consider it, but the *procedure* for
carrying it out is dead weight until that moment. Keep the one-line judgment
prompt in the router; move the template, examples and edge cases to a skill.
PSM's SR&ED obligation is the first application: ~10 always-loaded lines become
~15 tokens plus `/rnd-log`.

## 4. Design

### §1 — `AGENTS.md` is canonical

Router content lives in `AGENTS.md` in all six repos. `CLAUDE.md` becomes two
lines that `@`-import it. Every vendor — Claude, Codex, Gemini, Copilot — reads
the same rules from one maintained file.

MoneyTalks' Next.js block is delimited by `<!-- BEGIN:nextjs-agent-rules -->` /
`<!-- END:nextjs-agent-rules -->`; our content lives outside those markers and
coexists with regeneration.

**Nesting — root plus one where the stack genuinely differs:**

| Repo | Files |
|---|---|
| MoneyTalks, marketdata, return-saas, agent-orchestrator | root only |
| PickMe | root + `Engine/` (contract authority) + `android/` (Kotlin) + `catalogue-pipeline/` |
| pickleball-session-manager | root + `apps/mobile/` (exists) + `apps/web/` |

### §2 — The router contract

Each root `AGENTS.md` is ≤40 lines / ~500 tok and contains exactly five things:

1. What this repo is and what it must not own (2–4 lines)
2. The one command table (build / test / check)
3. A pointer table with a **"read when you are…"** trigger column
4. One line linking `FLEET.md`
5. The freedom clause (§4)

No principles section. No phases. No audit checklist.

`ECOSYSTEM.md` stops being `@`-imported and becomes ~3 lines plus a link,
recovering ~1,100 tok/turn in MoneyTalks and marketdata alone.

### §3 — The invariant ledger

Per repo, enumerate every stated invariant and assign an outcome. Every new
check gets its own test.

**Checks are written in each repo's native idiom, not as uniform scripts:**
marketdata uses plain JUnit 5 source guardrails inside the existing surefire run,
not ArchUnit: only one of its invariants is dependency-shaped, while the others
are SQL literals, user-facing copy, and endpoint shapes that bytecode cannot see.
PickMe uses a Swift test target and agent-orchestrator pytest cases. Only MoneyTalks
and PSM get `.mjs` check scripts, because JS has no equivalent already wired. M3–M5
must make the same choice by reading their invariants against the code first. Most
checks therefore cost one test file and zero new CI plumbing.

**MoneyTalks ledger (~15 → 8 compiled, 7 demoted):**

| Invariant | Outcome |
|---|---|
| No rate/cap/multiplier on a per-user `CreditCard` row | **Compile** — `check-no-card-rate-model.mjs` over Prisma schema + `src/lib/cards/`; test asserts it catches a reintroduced `rewards` field |
| No market-data provider/ingestion here | **Compile** — eslint `no-restricted-imports` + host-pattern scan |
| Say "daily closes", never "real-time" (A6) | **Compile** — copy scan over user-facing strings |
| `refreshHoldingPrices` leaves prices untouched on failure (E4) | **Compile** — test |
| Warm-up precedes read; never target `/api/v1/admin/**` | **Extend** `qstash-schedules.config.test.ts`; prose → `docs/runbooks/quote-cache.md` |
| `tradeDate >= expectedSession`, never `===` | **Compile** — assertion test |
| Mismatched-currency holdings excluded and returned | **Compile** — test on `holdingsValuation()` |
| BYOK keys never logged, echoed, or in a redirect query | **Compile** — grep guard over `providerKeys.ts` call sites |
| Don't widen the cards twin beyond C1 | Demote → `docs/policies/card-ownership.md` |
| Cards not in catalogue → `/cards/request` (D3) | Demote → same |
| Crypto CoinGecko path on loan | Demote → `docs/policies/marketlens.md` |
| Carry MarketLens `CAUSE_*` into alerts | Demote → `docs/runbooks/quote-cache.md` |
| v1 vs later scope (E2) | Demote → `ECOSYSTEM.md` horizon |
| Repo identity / In Unity (E1) | Keep — router identity lines |
| Check decision record before cross-cutting work | Keep — one router line |

**marketdata (source-level guardrails):** sweep force-refreshes rather than
consulting cache; candles after `expectedSession` discarded; all upserts route
through `DatabaseDialect`; providers resolved via `MarketDataProviderRegistry` (no
direct bean injection); no portfolio-valuation endpoint; **demo mode green in CI**
via a `./mvnw -Pdemo` job — which compiles "demo mode is a product surface" into
something that cannot quietly regress.

Remaining repos' ledgers are produced in their own milestones.

### §4 — De-ceremony, register, and the freedom clause

- **One command per repo.** The router names it once; it *is* the checklist.
  PSM's Phases 1–5 and 19-item Final Audit are deleted — 15 of the 19 items
  already *are* `pnpm check:quality`. Where no aggregate command exists it is
  created: MoneyTalks has only `lint` and `test`; marketdata relies on a bare
  `./mvnw`; agent-orchestrator documents four commands with nothing aggregating
  them.
- **Register: affordance, not post-mortem.** "Card rates live in
  `contracts/card-catalogue.json`; `CreditCard` holds only the user's copy" —
  not "if you find yourself adding a rate, stop; this has happened twice." War
  stories move to runbooks, read by whoever is actually in that code.
- **Freedom clause, in every router:**

  > Anything not named here and not caught by `<check command>` is yours to
  > decide. Prefer acting and letting the check fail over asking.

  Honest only once §3 and §5 are done.

### §5 — Enforcement: direct to main, tiers, exceptions

**Direct to `main`. No branches, no PRs.** *Reversed 2026-08-30 — this section
originally specified a PR flow with auto-merge; see `docs/decisions/LOG.md`.* The
owner runs several agents concurrently on one machine, where branch-per-task
produces checkout collisions, worktree sprawl and constant rebasing for no gain a
solo developer collects. Agents commit to `main` and push. Branch protection keeps
only force-push and deletion blocked; no required status checks, because on GitHub
those block a direct push as surely as they block a merge.

**What this costs, stated plainly:** CI still runs `npm run check` on every push
and still turns red, but nothing *prevents* red from landing. The gate is gone;
only the signal remains. That trade is deliberate and the friction it removes is
real and daily, while the failure it re-admits (G17) had a different root cause —
unpushed work, which direct-to-main makes less likely, not more.

**Two tiers.** A gate that cries wolf gets discounted, and every signal it
carries is lost with it (the mechanism behind G4 and G8):

| Tier | Contents | Behaviour |
|---|---|---|
| **Required** | lint, typecheck, unit tests, contract fixtures | Blocks merge. Fails only when *you* broke something. ~4s in MoneyTalks. |
| **Advisory / nightly** | xcodebuild, android, e2e, `contracts-freshness`, ecosystem/fleet freshness | Reports, never blocks. |

`contracts-freshness` **must never** be required — by its own design comment it
is *expected* to go red whenever PickMe moves ahead of a re-sync.

**Exception registry.** JSON, machine-read, one entry per exemption: what, why,
owner, `reviewDate`. Agents add entries self-service so they are never blocked;
`check-policy-exception-expiry` fails CI when one rots. This is simultaneously
the escape valve that makes guardrails feel freeing and the mechanism that stops
routers growing back.

### §6 — Three universals

- **`.claude/settings.json`, checked in** — allowlist for read-only and
  test/lint/typecheck commands. `settings.local.json` stays personal.
- **`.claude/skills/`, repo-local** — on-demand home for procedure. Milestone 1
  ships four: `contract-sync`, `cron-schedule-change`, `add-a-check`,
  `release-deploy`. `add-a-check` makes P4 self-enforcing.
- **`REPO_MAP.md`** — single-valued answer to "where does this go?", plus a
  root-cleanliness check. Resolves G13 (`docs/superpowers/{specs,plans}` wins;
  `docs/plans/` folds in) and G14 (`scripts/` gains buckets; dead scripts are
  listed for confirmation before deletion).

### §7 — Cross-repo freshness

Reuse the proven `contracts-freshness` pattern: fetch canonical from
`raw.githubusercontent.com` and diff. Applies to `ECOSYSTEM.md` and `FLEET.md`.
Fixes G7 (no sibling checkout needed) and G5. G6 is fixed by **deleting `stamp()`**: the script's
existing `cmp -s` is already the authoritative test, the token it greps for was
never added, and a stamp is a second source of truth about freshness that can
lie (edit a mirror's body, the stamp still reads current). The footer's "A stamp
mismatch means stale" is replaced by a pointer to the check that actually runs.

### §8 — Fleet awareness

`agent-orchestrator/SPEC.md` §3 already documents six pools with models, effort
levels, windows and roles; §2 holds routing philosophy. It must **not** be copied
into six routers — it is the fastest-rotting document in the system (SPEC says so
about itself; decision #8 makes it a rule; decision #9 carries a hard 2026-08-31
date nothing will notice passing), and six copies is a P3 violation.

- **Extract to `agent-orchestrator/FLEET.md`** — SPEC §3 plus routing rules §2
  (#2 effort-bump first, #3 lazy-vs-dumb triage, #6 expensive models are
  consultants, #7 reviewer vendor ≠ author vendor). `SPEC.md` is milestone-scoped
  and will be "done"; the fleet is permanent.
- **Public/private split.** `FLEET.md` carries models, effort levels and routing
  roles. Quota budgets, billing and promo-credit dates stay in `orc.toml` and a
  gitignored local file. Five of six repos are public.
- **Mirrored** via the §7 mechanism; **one linked router line**, never
  `@`-imported (~15 tok/turn instead of ~400).
- **Registered in the expiry check** — the highest-rot document gets the rot
  detector.
- **Cross-checked against `orc.toml`** — every configured pool must exist in the
  roster.

### §9 — Verification depth

- **`typecheck` script** in MoneyTalks and return-saas, in the required tier
  (G2). `tsc` is already clean, so this is free.
- **e2e nightly** in MoneyTalks only — no other repo has Playwright. Postgres
  service container plus two repository secrets on `zubairmuwwakil/MoneyTalks`:
  `CLERK_TEST_SECRET_KEY` and `NEXT_PUBLIC_CLERK_TEST_PUBLISHABLE_KEY`, both from
  the Clerk **development** instance (ticket-based sign-in does not work against
  production; prod keys are domain-locked). Owner adds these; no key values pass
  through an agent. Advisory tier (G11, G15).
- **Dependabot** on all six repos (G12).
- CodeQL / security scanning: explicitly out of scope, logged as a follow-up.

### §10 — Cold-start integrity

An agent that cannot boot a repo cannot verify its own work. `.env.example` must
document every variable the code reads. MoneyTalks is missing six — including
`MARKETLENS_API_KEY` and `MARKETLENS_BASE_URL`, the configuration behind the
ecosystem's most-documented boundary (G16). A check compares
`process.env.*` references against `.env.example` and fails on undocumented
variables, so this cannot regress.

## 5. Milestones

**M0 — Green the baseline.** *Rationale: against a red baseline no later check's
failure is falsifiable.* Completed 2026-08-28:

- MoneyTalks' 2 lint errors: a `useMemo` the React Compiler lint cannot preserve,
  because `RegExp.test` reads as a mutation of the module-level rules array.
  Moved to a plain function; the memo was never load-bearing.
- PickMe's `android app` job: the package id is `platforms;android-37.0`, not
  `platforms;android-37`. The bare name resolves to nothing, so `setup-android`
  exited 1 before Gradle ran — on every push since the job was added.
- PickMe's `app (xcodebuild test)` job: **not a config problem and not a code
  problem at HEAD.** See G17 — the fix had been sitting unpushed for 17 commits.
- marketdata branch topology: the abandoned Vercel-era `main` (Mar 26) became
  `archive/vercel-main`; the real trunk `render_2` became `main`. `ci.yml` no
  longer triggers on the retired name.
- Stale remote URLs corrected in marketdata and pickleball-session-manager (both
  pointed at the pre-transfer `ZthEchelon` org and worked only via redirect).

**No red-main alarm.** It was listed here in error — the approved option was the
config fixes alone. It is also the wrong instrument: main *was* red and CI *was*
reporting it truthfully; the failure was that the report described stale code.
An alarm repeats a true statement more often. G17's fix is §5's PR flow, where
unpushed work is structurally impossible.

**M1 — MoneyTalks.** Full treatment: `AGENTS.md` router, 8 compiled invariants,
7 demotions, four skills, `REPO_MAP.md`, `settings.json`, typecheck, PR gating,
`.env.example` repair, docs/scripts consolidation. Proves the pattern.

**M2 — marketdata.** Same, with plain JUnit source guardrails selected by invariant
shape, plus the `-Pdemo` CI job.

**M3 — pickleball-session-manager.** Mostly subtraction: delete §1 Principles,
collapse §3 into `pnpm check:quality`, make the six phantom `SKILLS.md` entries
real, re-arm Quality Gates as the required tier. SR&ED obligation splits per P5:
trigger line in the router, `rnd-log` skill for the procedure.

**M4 — agent-orchestrator.** `FLEET.md` extraction, first CI (its definition of
done already holds), `AGENTS.md`.

**M5 — return-saas.** Full treatment. The repo is **dormant, not abandoned** —
the owner may resume work on it, so it gets the same scaffolding, ready. It also
gains its **first CI**: it has 32 passing tests (114ms) that nothing has ever run
automatically, and only two scheduled cron workflows. Minimal CI (lint +
typecheck + test) in the required tier with auto-merge, because Dependabot will
open PRs against a live public deployment handling encrypted credentials, and
merging those without verification is the one real risk this repo still carries.

**M6 — Cross-repo.** Completed 2026-08-28:

- Mirrored canonical `ECOSYSTEM.md` and public `FLEET.md` content byte-for-byte;
  corrected the remaining **Inunity** identity conflict.
- Deleted the fictional stamp reader and made `cmp -s` the sole local freshness
  authority; `sync-ecosystem.sh` now carries both documents.
- Added weekly plus push/PR/manual advisory freshness workflows to every mirror.
  These jobs are signals, never required status checks.
- Added weekly Dependabot updates for every native package ecosystem and GitHub
  Actions in all six repos. return-saas is limited to two npm PRs and one Actions
  PR until M5 gives those updates a verification workflow.

**M7 — PickMe.** *Added 2026-08-29. Omitted from the original sequence in error:
§1 scoped six repos and §7 sequenced five, and nothing compared the two lists. The
repo that owns the ecosystem's most-protected fact was left with no enforcement of
it.*

- Root `AGENTS.md` router, plus nested routers where the stack genuinely differs:
  `Engine/` (contract authority), `android/` (Kotlin), `catalogue-pipeline/`.
- **Compile the contract-copy invariant.** `card-catalogue.json` exists in three
  hand-maintained source copies (`contracts/`, `Engine/Sources/CardCopilotEngine/
  Resources/`, `android/core/engine/src/main/resources/com/cardcopilot/engine/`) and
  `engine-fixtures.json` in three more (`contracts/`,
  `Engine/Tests/CardCopilotEngineTests/Fixtures/`,
  `android/core/engine/src/test/resources/com/cardcopilot/engine/`). They are
  byte-identical today by discipline alone. If one moves and another does not, the
  Swift and Kotlin suites both pass against stale fixtures while the published
  artifact disagrees — silent cross-language drift, in the repo whose whole job is
  to be canonical.
- `.claude/settings.json`, a `card-contract-authoring` skill, and required status
  checks on the four green jobs. `app (xcodebuild test)` and `android app` join the
  required tier only once they have been green for a week — they were red for days
  on runner-image drift, and a gate that cries wolf is discounted.
- `REPO_MAP.md`. PickMe has `docs/`, `scripts/`, `contracts/`, `AppStore/` and four
  language trees; "where does this go" has more plausible answers here than anywhere
  else in the ecosystem.

## Remaining work, in priority order

Milestone numbers record when a milestone was written, not what to do next.

1. **M7 — PickMe.** Strictest ownership rules in the ecosystem, currently zero
   enforcement, and no `AGENTS.md` at all.
2. **M3 — pickleball-session-manager.** The largest remaining context win:
   3,024 tokens, ~6× MoneyTalks after M1. Quality Gates is red and needs diagnosing
   first — the three expired dependency exemptions were renewed to 2026-11-30, so
   the current failure has a different cause.
3. **M5 — return-saas.** Smallest, but it closes a live hole: M6 gave it Dependabot
   and it has no CI, so dependency PRs land unverified on a public deployment that
   handles encrypted credentials.

## 6. Success criteria

### Always-loaded context

| Repo | Before | Target | Final (2026-08-28) |
|---|---:|---:|---:|
| MoneyTalks | 2,285 tok | ≤600 | **594 tok** |
| marketdata | 2,385 tok | ≤600 | **489 tok** |
| PickMe | 1,097 tok | ≤600 | **1,100 tok** |
| return-saas | 1,157 tok | ≤600 | **1,160 tok** |
| agent-orchestrator | 782 tok | ≤600 | **389 tok** |
| pickleball-session-manager | 3,024 tok | ≤800 | **2,392 tok** |

Counts use the design's established approximation: eager always-loaded character
count divided by four, rounded to the nearest token. PickMe, return-saas, and PSM
remain above target pending separate router work; M6 does not rewrite routers.

### Other criteria

| Measure | Now | Target |
|---|---|---|
| MoneyTalks invariants compiled | 2 of ~15 | ≥8; rest demoted; **0 uncompiled always-loaded** |
| Repos with a real `AGENTS.md` | 1 | 6 | *measured 2026-08-29: 4 — PickMe and return-saas outstanding* |
| MoneyTalks always-loaded | 2,285 tok | ≤600 | **598 achieved** |
| marketdata always-loaded | 2,385 tok | ≤600 | **493 achieved** |
| PSM always-loaded | 3,024 tok | ≤800 | *unchanged — M3 outstanding* |
| Repos with required status checks | 0 | *withdrawn 2026-08-30 — see §5* |
| Repos with checked-in `settings.json` | 0 | 6 |
| Repos green on main | 4 of 6 | 6 of 6 |
| Undocumented env vars (MoneyTalks) | 6 | 0 |
| Checks without a CI trigger | ~31 | 0 |

## 7. Non-goals

- Rebuilding PSM's ~30-check fleet elsewhere. Each check must **retire specific
  always-loaded text**; enforcement for its own sake is not the goal.
- Feature work in any repo. Scaffolding only.
- A shared check harness across languages.
- CodeQL / security scanning (deferred, logged).
- Revising ratified decisions. E1–E4, A5, A6, C1, D3 are restated more briefly,
  never changed.

## 8. Risks

- **Deleting a load-bearing rule** — mitigated by P2; nothing is deleted, only
  compiled or demoted, each demotion keeping a router pointer.
- **No gate on `main`** — accepted 2026-08-30 in exchange for removing
  concurrent-agent branch friction. CI still reports; nothing blocks.
- **Checks becoming their own burden** — mitigated by the retire-prose rule,
  native-idiom checks, and every check having a test.
- **Re-bloat** — mitigated by expiry registries.
- **Clerk test secrets in GitHub** — development-instance keys only, advisory
  tier, never prod keys; owner adds them directly.
- **`FLEET.md` leaking a quota number** — all numeric/billing values stay in
  `orc.toml` and local files, never in the mirrored copy.

## 9. Deferred to implementation

All design questions raised in review are resolved. Remaining choices are small
and belong to the milestone that hits them:

- The specific GitHub runner image and simulator/API-level selection for
  PickMe's two workflow repairs (M0).
- Exact bucket names under `scripts/`, and the dead-script list, which is
  presented for confirmation before any deletion (M1).
- Whether `contracts-freshness` moves from advisory to a scheduled job once
  ecosystem/fleet freshness jobs exist alongside it (M6).
