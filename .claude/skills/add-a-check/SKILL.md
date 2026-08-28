---
name: add-a-check
description: Use when adding a guardrail, compiling a rule into an automated check, or when told a rule should be enforced rather than documented in this repo.
---

# Adding a guardrail

A check is where a rule goes **so it can stop being said**. If adding it does not
let you delete prose, reconsider whether it is worth adding.

## Non-negotiables

1. **The check, its test, and its CI trigger land in the same commit.** A check
   that runs nowhere is prose with extra steps — and worse, because it *feels*
   enforced. Three exemptions in a sibling repo rotted for four weeks behind a
   correct check nothing ran.
2. **Every check has its own test.** A guardrail that breaks silently is worse than
   none. Export the detector function and test it against fixture trees, not against
   the real repo.
3. **It must retire specific prose.** Name in the commit message what you deleted.

## Recipe

1. Create `scripts/checks/check-<noun>.mjs`. Export a pure detector
   (`findX(dir): Hit[]`) and guard the CLI entry with
   `if (import.meta.url === \`file://${process.argv[1]}\`)`.
2. Create `scripts/checks/check-<noun>.test.ts` covering: a clean tree passes, a
   violating tree fails, and at least one near-miss that must **not** fire.
3. Add `"check:<noun>"` to `package.json` and append it to the `check` chain.
4. Delete the prose it replaces, from `AGENTS.md` or a policy file.
5. `npm run check`, then commit everything together.

## When a check is wrong for a task

Do not weaken the check and do not stop to ask. Add an entry to
[`docs/policies/exceptions.json`](../../../docs/policies/exceptions.json) with `id`,
`check`, `path`, `why`, `owner`, and a `reviewDate`. CI fails once it expires, so
the exemption cannot become permanent by accident.
