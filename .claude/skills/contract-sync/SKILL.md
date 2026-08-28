---
name: contract-sync
description: Use when vendoring card contract files from PickMe into this repo, when contracts-freshness goes red, or when the card catalogue, engine fixtures, or a contract schema needs updating.
---

# Syncing card contracts from PickMe

PickMe owns these files. This repo vendors them. Swift is canonical, so a contract
change lands in PickMe first — always.

## Order (not negotiable)

1. **Commit in PickMe first**, Swift + fixtures together. Verify there:
   `cd Engine && swift test` and `cd android && ./gradlew :core:engine:test`.
2. **Push PickMe.** The manifest records a commit; an unpushed one is provenance
   nobody else can check.
3. **Sync here:** `./scripts/sync/sync-contracts.sh` (local sibling checkout) or
   `./scripts/sync/sync-contracts.sh --ref main` (fetches PickMe's raw URLs).
4. **Verify:** `npx vitest run src/engine/cards-twin/fixtures.test.ts`, then `npm run check`.
5. **Commit** the vendored files and any twin change **together** — fixtures that
   exercise a new engine capability fail until the twin reads it, so splitting them
   leaves a red intermediate commit.

## The dirty-source guard

The script refuses to sync while PickMe's `contracts/` has uncommitted changes. That
is deliberate. A manifest asserting "PickMe at <sha> had <bytes>" for a pairing that
exists in no PickMe commit is worse than no manifest, because both repos' local drift
tests stay green while the two genuinely disagree. It happened on 2026-08-24.

`--allow-dirty` exists and records a `-dirty` suffix. Use it only when you understand
you are recording unverifiable provenance.

## contracts-freshness is meant to go red

That CI job compares our vendored copy against PickMe `main`. It is **expected** to
fail whenever PickMe moves ahead of a re-sync — that is the signal, not a breakage.
It is advisory and must never be a required check.
