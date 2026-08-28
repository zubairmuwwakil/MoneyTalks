# Repo Map — where things go

**Audience:** agents (Claude, Codex, Copilot, Gemini) and humans producing files here.

`AGENTS.md` governs *how to write code*. This file answers the question agents get
wrong most often: **"I just produced X — where does it go?"** When that has more
than one plausible answer, sprawl happens. Enforced by `npm run check:layout`.

## The one rule

**Do not create a new top-level folder under `docs/` or `scripts/`.** Pick a
bucket. If nothing fits, write an ADR in `docs/decisions/` proposing the new
bucket — do not add it silently. Two competing plan directories is how the last
one started.

## Docs

| I just produced… | It goes in… |
|---|---|
| A design or spec | `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` |
| An implementation plan | `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` |
| An architectural decision | `docs/decisions/YYYY-MM-DD-<title>.md`, plus a line in `docs/decisions/LOG.md` |
| A policy, or an exemption | `docs/policies/` — exemptions go in `exceptions.json` with a `reviewDate` |
| An ops procedure or on-call playbook | `docs/runbooks/<slug>.md` |
| A generated report | `docs/reports/` |
| Anything containing personal data | `docs/private/` — gitignored, and this repo is public |
| A superseded document | `docs/archive/<year>/` |

**Not in `docs/`:** working notes, status updates, or a forked copy of a doc.
Supersede via ADR instead.

## Scripts

| I just produced… | It goes in… |
|---|---|
| A guardrail check | `scripts/checks/check-<noun>.mjs` + a co-located `.test.ts` |
| A cross-repo sync | `scripts/sync/` |
| A seed | `scripts/seeds/` |
| An asset or fixture generator | `scripts/generators/` |
| A scheduled job, probe, or import | `scripts/ops/` |
| A script that has served its purpose | `scripts/archive/` |

A script that resolves paths from its own location must account for the bucket:
both sync scripts compute the repo root as `$SCRIPT_DIR/../..`, not `/..`.

Every new check needs its own test and its CI trigger **in the same commit** — see
the `add-a-check` skill.
