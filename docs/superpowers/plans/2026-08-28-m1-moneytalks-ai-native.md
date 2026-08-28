# M1 — MoneyTalks AI-Native Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut MoneyTalks' always-loaded agent context from ~2,285 tokens to ≤600 by compiling eight invariants into CI-triggered checks and demoting seven to on-demand policy files, then gate the result behind required status checks.

**Architecture:** `AGENTS.md` becomes the canonical router (≤40 lines) that every vendor reads; `CLAUDE.md` shrinks to a two-line `@`-import of it. Each invariant currently stated in prose either becomes a check script with its own test and a CI trigger, or moves to `docs/policies/` reached by a markdown link — never an `@`-import, which loads eagerly. Checks run inside the existing vitest suite where they assert behaviour, and as `.mjs` scripts under `scripts/checks/` where they scan the tree.

**Tech Stack:** Next.js, TypeScript, Prisma, vitest, eslint flat config (`eslint.config.mjs`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-28-ai-native-repos-design.md`

## Global Constraints

- **P1 Compile to delete.** Every check added here must retire specific always-loaded prose. A check that retires nothing is out of scope.
- **P2 Compile or demote.** No invariant is deleted. What cannot become a check moves to `docs/policies/` or `docs/runbooks/`, reached by exactly one router line.
- **P3 One owner.** Card semantics belong to PickMe, market data to MarketLens. This milestone restates those boundaries more briefly; it never revises them.
- **P4 No check ships without a trigger.** A check and its CI wiring land in the *same commit*. A check that runs nowhere is not done.
- **P5 Always-load the trigger, demote the procedure.**
- **Every check gets its own test.** A guardrail that can silently break is worse than none.
- **`@file` in an instruction file is an eager import.** Demotion is only real via a markdown link.
- **Ratified decisions are immovable:** E1–E4, A5, A6, C1, D3. Restate, never revise.
- **Router budget:** root `AGENTS.md` ≤ 40 lines. Asserted by a test in Task 10.
- **Commit style:** Conventional Commits. **Never** add `Co-Authored-By` trailers.

---

### Task 1: Cold-start integrity — typecheck script and a complete `.env.example`

Closes G2 and G16. An agent that cannot boot the repo cannot verify its own work, and `MARKETLENS_API_KEY` — the configuration behind the ecosystem's most-documented boundary — is currently undocumented.

**Files:**
- Modify: `package.json` (add `typecheck` script)
- Modify: `.env.example` (add 6 missing variables)
- Create: `scripts/checks/check-env-documented.mjs`
- Test: `scripts/checks/check-env-documented.test.ts`

**Interfaces:**
- Produces: `npm run typecheck` → `tsc --noEmit`, exit 0 on success. Consumed by Task 2 and Task 12.
- Produces: `scripts/checks/check-env-documented.mjs`, exit 0 clean / 1 with a list of undocumented variables. Consumed by Task 2.
- Produces exported function `findUndocumentedEnvVars(srcDir, envExamplePath): string[]` for the test to call directly.

- [ ] **Step 1: Write the failing test**

Create `scripts/checks/check-env-documented.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findUndocumentedEnvVars } from "./check-env-documented.mjs";

function fixture(srcFiles: Record<string, string>, envExample: string) {
  const root = mkdtempSync(join(tmpdir(), "envcheck-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  for (const [name, body] of Object.entries(srcFiles)) {
    writeFileSync(join(src, name), body);
  }
  const env = join(root, ".env.example");
  writeFileSync(env, envExample);
  return { root, src, env };
}

describe("findUndocumentedEnvVars", () => {
  it("reports a variable read in src but absent from .env.example", () => {
    const f = fixture(
      { "a.ts": "export const k = process.env.MARKETLENS_API_KEY;" },
      "DATABASE_URL=postgres://x\n",
    );
    expect(findUndocumentedEnvVars(f.src, f.env)).toEqual(["MARKETLENS_API_KEY"]);
    rmSync(f.root, { recursive: true, force: true });
  });

  it("returns empty when every variable is documented", () => {
    const f = fixture(
      { "a.ts": "export const k = process.env.MARKETLENS_API_KEY;" },
      "MARKETLENS_API_KEY=\n",
    );
    expect(findUndocumentedEnvVars(f.src, f.env)).toEqual([]);
    rmSync(f.root, { recursive: true, force: true });
  });

  it("ignores NODE_ENV, which the runtime supplies", () => {
    const f = fixture({ "a.ts": "if (process.env.NODE_ENV === 'test') {}" }, "");
    expect(findUndocumentedEnvVars(f.src, f.env)).toEqual([]);
    rmSync(f.root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-env-documented.test.ts`
Expected: FAIL — cannot resolve `./check-env-documented.mjs`.

- [ ] **Step 3: Write the check**

Create `scripts/checks/check-env-documented.mjs`:

```js
#!/usr/bin/env node
// Fails when src/ reads a process.env variable that .env.example does not document.
// An agent that cannot boot the repo cannot verify its own work, and the gap this
// catches was real: MARKETLENS_API_KEY and MARKETLENS_BASE_URL — the configuration
// behind the E3/E4 boundary — were undocumented while the boundary itself was the
// most heavily documented rule in the repo.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// Supplied by the runtime or the platform, never by a developer's .env file.
const RUNTIME_PROVIDED = new Set(["NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "CI"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx", ".mts", ".js", ".mjs"].includes(extname(full))) out.push(full);
  }
  return out;
}

export function findUndocumentedEnvVars(srcDir, envExamplePath) {
  const referenced = new Set();
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) referenced.add(m[1]);
  }
  const documented = new Set(
    readFileSync(envExamplePath, "utf8")
      .split("\n")
      .map((line) => line.match(/^([A-Z0-9_]+)\s*=/)?.[1])
      .filter(Boolean),
  );
  return [...referenced]
    .filter((name) => !documented.has(name) && !RUNTIME_PROVIDED.has(name))
    .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const missing = findUndocumentedEnvVars("src", ".env.example");
  if (missing.length > 0) {
    console.error("check-env-documented: read in src/ but absent from .env.example:");
    for (const name of missing) console.error(`  ${name}`);
    console.error("\nAdd each with an empty value and a comment saying what it is for.");
    process.exit(1);
  }
  console.log("check-env-documented: every referenced variable is documented");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/checks/check-env-documented.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the check against the real repo and confirm it fails**

Run: `node scripts/checks/check-env-documented.mjs`
Expected: FAIL listing `ADMIN_EMAIL`, `AUTH_EMAIL_FROM`, `AUTH_RESEND_KEY`, `MARKETLENS_API_KEY`, `MARKETLENS_BASE_URL`, `QSTASH_REGION`.

- [ ] **Step 6: Document the six variables**

Append to `.env.example`:

```bash
# Address that receives operational alerts (price staleness, cron failures).
ADMIN_EMAIL=
# From: address on outbound auth and digest mail.
AUTH_EMAIL_FROM=
# Resend API key used for auth and digest mail.
AUTH_RESEND_KEY=
# MarketLens consumer key ("may you call MarketLens"). NOT a provider key —
# provider keys are stored encrypted per user, see src/lib/security/providerKeys.ts.
MARKETLENS_API_KEY=
# Base URL of the MarketLens deployment this hub consumes (E3/E4).
MARKETLENS_BASE_URL=
# QStash region for the scheduled price and FX jobs.
QSTASH_REGION=
```

- [ ] **Step 7: Add the typecheck script**

In `package.json`, add to `scripts`:

```json
"typecheck": "tsc --noEmit",
"check:env": "node scripts/checks/check-env-documented.mjs"
```

- [ ] **Step 8: Verify everything passes**

Run: `npm run typecheck && npm run check:env && npx vitest run scripts/checks/check-env-documented.test.ts`
Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git add package.json .env.example scripts/checks/check-env-documented.mjs scripts/checks/check-env-documented.test.ts
git commit -m "feat(checks): document every env var src reads, and add a typecheck script

MARKETLENS_API_KEY and MARKETLENS_BASE_URL were undocumented while the E3/E4
boundary they implement was the most heavily documented rule in the repo, so a
cold-start agent could not connect the hub to MarketLens or learn that it should.
check-env-documented fails on any process.env read that .env.example omits.

tsc --noEmit already passed across 432 files with zero errors; it just had no
script, so an agent's only type signal was a full next build."
```

---

### Task 2: The one command

The router names one command and it *is* the checklist. This is what lets Task 10 delete the ceremony.

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run check` → lint, typecheck, env check, unit tests, in that order, failing fast. Consumed by Task 10 (named in the router) and Task 12 (the required CI tier).

- [ ] **Step 1: Add the aggregate script**

In `package.json` `scripts`, add:

```json
"check": "npm run lint && npm run typecheck && npm run check:env && npm run test"
```

Order is cheapest-signal-first so a failure surfaces fast.

- [ ] **Step 2: Run it**

Run: `npm run check`
Expected: PASS. Total runtime should be well under a minute — the unit suite alone is ~4s for 1,141 tests.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(scripts): add npm run check as the single verification entry point

The router names one command instead of reciting a checklist. Ordered
cheapest-signal-first: lint, typecheck, env, tests."
```

---

### Task 3: The exception registry and its expiry check

Infrastructure every later check depends on. An exception is **data with a `reviewDate`**; CI fails when one rots. This is simultaneously the escape valve that keeps guardrails from feeling confining and the mechanism that stops the router growing back.

**Files:**
- Create: `docs/policies/exceptions.json`
- Create: `scripts/checks/check-policy-exception-expiry.mjs`
- Test: `scripts/checks/check-policy-exception-expiry.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `findExpiredExceptions(registryPath, today: Date): {id: string, reviewDate: string}[]`.
- Produces: registry schema — an array of objects with `id` (string), `check` (string, the check id it exempts), `path` (string, the file or glob exempted), `why` (string), `owner` (string), `reviewDate` (string, `YYYY-MM-DD`).
- Produces: `loadExceptionsFor(checkId): {path: string}[]`, used by Tasks 4–6 so a check can honour its exemptions.

- [ ] **Step 1: Write the failing test**

Create `scripts/checks/check-policy-exception-expiry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExpiredExceptions, loadExceptionsFor } from "./check-policy-exception-expiry.mjs";

function registry(entries: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "exc-"));
  const file = join(dir, "exceptions.json");
  writeFileSync(file, JSON.stringify(entries, null, 2));
  return { dir, file };
}

const base = {
  id: "e1",
  check: "no-card-rate-model",
  path: "src/lib/cards/legacy.ts",
  why: "migration in flight",
  owner: "zub",
};

describe("findExpiredExceptions", () => {
  it("reports an exception whose reviewDate has passed", () => {
    const r = registry([{ ...base, reviewDate: "2026-01-01" }]);
    const expired = findExpiredExceptions(r.file, new Date("2026-08-28"));
    expect(expired.map((e) => e.id)).toEqual(["e1"]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("does not report one whose reviewDate is in the future", () => {
    const r = registry([{ ...base, reviewDate: "2027-01-01" }]);
    expect(findExpiredExceptions(r.file, new Date("2026-08-28"))).toEqual([]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("treats the reviewDate itself as still valid", () => {
    const r = registry([{ ...base, reviewDate: "2026-08-28" }]);
    expect(findExpiredExceptions(r.file, new Date("2026-08-28"))).toEqual([]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("rejects an entry missing a required field", () => {
    const { owner, ...noOwner } = base;
    const r = registry([{ ...noOwner, reviewDate: "2027-01-01" }]);
    expect(() => findExpiredExceptions(r.file, new Date("2026-08-28"))).toThrow(/owner/);
    rmSync(r.dir, { recursive: true, force: true });
  });
});

describe("loadExceptionsFor", () => {
  it("returns only the entries for the named check", () => {
    const r = registry([
      { ...base, reviewDate: "2027-01-01" },
      { ...base, id: "e2", check: "other-check", path: "src/x.ts", reviewDate: "2027-01-01" },
    ]);
    expect(loadExceptionsFor("no-card-rate-model", r.file)).toEqual([
      { path: "src/lib/cards/legacy.ts" },
    ]);
    rmSync(r.dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-policy-exception-expiry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the check**

Create `scripts/checks/check-policy-exception-expiry.mjs`:

```js
#!/usr/bin/env node
// Every guardrail exemption is data with a clock on it. Agents add entries
// self-service so a check never blocks work outright; this fails CI once an
// entry is past its reviewDate, so exemptions cannot silently become permanent.
import { readFileSync, existsSync } from "node:fs";

const REQUIRED = ["id", "check", "path", "why", "owner", "reviewDate"];
const DEFAULT_REGISTRY = "docs/policies/exceptions.json";

function load(registryPath) {
  if (!existsSync(registryPath)) return [];
  const entries = JSON.parse(readFileSync(registryPath, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${registryPath}: expected a JSON array`);
  for (const entry of entries) {
    for (const field of REQUIRED) {
      if (typeof entry?.[field] !== "string" || entry[field].length === 0) {
        throw new Error(`exception ${entry?.id ?? "(no id)"}: missing required field "${field}"`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewDate)) {
      throw new Error(`exception ${entry.id}: reviewDate must be YYYY-MM-DD`);
    }
  }
  return entries;
}

export function findExpiredExceptions(registryPath = DEFAULT_REGISTRY, today = new Date()) {
  const cutoff = today.toISOString().slice(0, 10);
  return load(registryPath).filter((e) => e.reviewDate < cutoff);
}

export function loadExceptionsFor(checkId, registryPath = DEFAULT_REGISTRY) {
  return load(registryPath)
    .filter((e) => e.check === checkId)
    .map((e) => ({ path: e.path }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const expired = findExpiredExceptions();
  if (expired.length > 0) {
    console.error("check-policy-exception-expiry: these exemptions are past review:");
    for (const e of expired) {
      console.error(`  ${e.id} (${e.check} on ${e.path}) — due ${e.reviewDate}, owner ${e.owner}`);
    }
    console.error("\nRemove the exemption and fix the code, or extend reviewDate with a reason.");
    process.exit(1);
  }
  console.log("check-policy-exception-expiry: no exemption is past review");
}
```

- [ ] **Step 4: Create the empty registry**

Create `docs/policies/exceptions.json`:

```json
[]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run scripts/checks/check-policy-exception-expiry.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Wire it into the one command**

In `package.json`, change `check` to include it:

```json
"check:exceptions": "node scripts/checks/check-policy-exception-expiry.mjs",
"check": "npm run lint && npm run typecheck && npm run check:env && npm run check:exceptions && npm run test"
```

- [ ] **Step 7: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/policies/exceptions.json scripts/checks/check-policy-exception-expiry.mjs scripts/checks/check-policy-exception-expiry.test.ts package.json
git commit -m "feat(checks): exemptions become data with an expiry

An agent that hits a guardrail wrong for its task adds a registry entry and
keeps moving, so no check blocks work outright. Each entry carries what, why,
owner and reviewDate, and CI fails once one is past review — which is what stops
this milestone's routers from growing back six months from now."
```

---

### Task 4: Compile "no card rate model in this repo" (C1/D3)

Retires ~150 words of the longest prose block in `CLAUDE.md`. This drift has happened twice — first `src/engine/cards/`, then `src/lib/cards/presets.ts` + `CreditCard.rewards` + a 1,460-line editor — so it is the highest-value check in the milestone.

**Files:**
- Create: `scripts/checks/check-no-card-rate-model.mjs`
- Test: `scripts/checks/check-no-card-rate-model.test.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `loadExceptionsFor("no-card-rate-model")` from Task 3.
- Produces: `findRateFields(schemaText: string): string[]` — rate-shaped field names inside `model CreditCard`.
- Produces: `findRateModules(dir: string): string[]` — files under `src/lib/cards/` declaring a rate table.

- [ ] **Step 1: Write the failing test**

Create `scripts/checks/check-no-card-rate-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findRateFields } from "./check-no-card-rate-model.mjs";

const clean = `
model CreditCard {
  id             String  @id
  nickname       String
  limitMinor     Int?
  annualFeeMinor Int     @default(0)
  feeRebateMinor Int     @default(0)
  contractCardId String?
}
`;

describe("findRateFields", () => {
  it("passes the real per-user shape: fee and rebate columns are the owner's copy", () => {
    expect(findRateFields(clean)).toEqual([]);
  });

  it("catches a reintroduced rewards field", () => {
    const drifted = clean.replace("contractCardId String?", "rewards Json?\n  contractCardId String?");
    expect(findRateFields(drifted)).toEqual(["rewards"]);
  });

  it("catches a multiplier column", () => {
    const drifted = clean.replace("limitMinor     Int?", "earnMultiplier Decimal?");
    expect(findRateFields(drifted)).toEqual(["earnMultiplier"]);
  });

  it("catches a category cap column", () => {
    const drifted = clean.replace("limitMinor     Int?", "monthlyCapMinor Int?");
    expect(findRateFields(drifted)).toEqual(["monthlyCapMinor"]);
  });

  it("ignores rate-shaped fields on models that are not CreditCard", () => {
    expect(findRateFields(`${clean}\nmodel Offer {\n  rewardRate Decimal\n}\n`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-no-card-rate-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the check**

Create `scripts/checks/check-no-card-rate-model.mjs`:

```js
#!/usr/bin/env node
// The catalogue says what the CARD is; CreditCard says what the USER'S COPY is.
// A rate, cap, multiplier or credit on a per-user row is the drift this exists to
// stop, and it has happened twice: src/engine/cards/ (deleted), then
// src/lib/cards/presets.ts + CreditCard.rewards + a 1,460-line editor (deleted).
// Card facts resolve from contracts/card-catalogue.json via catalogueCard.ts.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadExceptionsFor } from "./check-policy-exception-expiry.mjs";

// Deliberately does NOT match annualFeeMinor or feeRebateMinor: an annual fee is
// a term of the owner's account, and the rebate is the owner's banking package —
// only the owner can say which tier they hold. Both are the user's copy, not the
// card's published rate model.
const RATE_SHAPED =
  /^(rewards?|earn[A-Z]\w*|reward[A-Z]\w*|cashback\w*|points?Per\w*|\w*[Mm]ultiplier|\w*[Cc]ap(Minor|Cents|Amount)?|categoryRate\w*|bonusRate\w*)$/;

export function findRateFields(schemaText) {
  const model = schemaText.match(/model\s+CreditCard\s*\{([\s\S]*?)\n\}/);
  if (!model) return [];
  const hits = [];
  for (const line of model[1].split("\n")) {
    const bare = line.trim();
    if (bare.startsWith("//") || bare.startsWith("@@") || bare.length === 0) continue;
    const name = bare.split(/\s+/)[0];
    if (RATE_SHAPED.test(name)) hits.push(name);
  }
  return hits;
}

export function findRateModules(dir) {
  if (!existsSync(dir)) return [];
  const exempt = new Set(loadExceptionsFor("no-card-rate-model").map((e) => e.path));
  const hits = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || exempt.has(full)) continue;
    const text = readFileSync(full, "utf8");
    if (/\b(CardRewards|CARD_PRESETS|cardPresets)\b/.test(text)) hits.push(full);
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fields = findRateFields(readFileSync("prisma/schema.prisma", "utf8"));
  const modules = findRateModules("src/lib/cards");
  if (fields.length > 0 || modules.length > 0) {
    console.error("check-no-card-rate-model: a card rate model is reappearing in this repo.");
    for (const f of fields) console.error(`  CreditCard.${f} — a rate on a per-user row`);
    for (const m of modules) console.error(`  ${m} — a hand-authored rate table`);
    console.error("\nCard rates belong to PickMe (C1). Facts resolve from");
    console.error("contracts/card-catalogue.json through src/lib/cards/catalogueCard.ts.");
    console.error("A card that is not in the catalogue goes through /cards/request (D3).");
    process.exit(1);
  }
  console.log("check-no-card-rate-model: no rate model in this repo");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/checks/check-no-card-rate-model.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Run against the real repo**

Run: `node scripts/checks/check-no-card-rate-model.mjs`
Expected: PASS. If it fails, the check is wrong — the repo is known clean as of 2026-08-28. Narrow `RATE_SHAPED` rather than adding an exception.

- [ ] **Step 6: Wire it in — check and trigger land together (P4)**

`package.json`:

```json
"check:cards": "node scripts/checks/check-no-card-rate-model.mjs",
"check": "npm run lint && npm run typecheck && npm run check:env && npm run check:exceptions && npm run check:cards && npm run test"
```

- [ ] **Step 7: Verify and commit**

Run: `npm run check`

```bash
git add scripts/checks/check-no-card-rate-model.mjs scripts/checks/check-no-card-rate-model.test.ts package.json
git commit -m "feat(checks): fail the build if a card rate model reappears here

Compiles the longest prose block in CLAUDE.md into an assertion. The rule has
been violated twice — src/engine/cards/, then presets.ts + CreditCard.rewards
plus a 1,460-line editor — and prose caught neither. The check deliberately
permits annualFeeMinor and feeRebateMinor: a fee is a term of the owner's
account and the rebate is their banking package, so both describe the user's
copy rather than the card's published rates."
```

---

### Task 5: Compile "market data has one owner and it is not this repo" (E3/E4)

**Files:**
- Create: `scripts/checks/check-no-market-data-provider.mjs`
- Test: `scripts/checks/check-no-market-data-provider.test.ts`
- Modify: `eslint.config.mjs`, `docs/policies/exceptions.json`, `package.json`

**Interfaces:**
- Consumes: `loadExceptionsFor("no-market-data-provider")` from Task 3.
- Produces: `findProviderHosts(dir, exemptPaths: string[]): {file: string, host: string}[]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/checks/check-no-market-data-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProviderHosts } from "./check-no-market-data-provider.mjs";

function tree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "mdp-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("findProviderHosts", () => {
  it("flags a direct Alpha Vantage call", () => {
    const root = tree({ "a.ts": 'fetch("https://www.alphavantage.co/query?f=x")' });
    expect(findProviderHosts(root, []).map((h) => h.host)).toEqual(["alphavantage.co"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a Yahoo quote endpoint", () => {
    const root = tree({ "a.ts": 'const u = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL"' });
    expect(findProviderHosts(root, []).map((h) => h.host)).toEqual(["finance.yahoo.com"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not flag the MarketLens base URL — consuming the service is the point", () => {
    const root = tree({ "a.ts": 'fetch(`${process.env.MARKETLENS_BASE_URL}/api/v1/quotes`)' });
    expect(findProviderHosts(root, [])).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("honours an exemption path", () => {
    const root = tree({ "lib/fetch-prices.ts": 'fetch("https://api.coingecko.com/api/v3/simple/price")' });
    expect(findProviderHosts(root, ["lib/fetch-prices.ts"])).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags CoinGecko outside the exempt path", () => {
    const root = tree({ "lib/elsewhere.ts": 'fetch("https://api.coingecko.com/api/v3/simple/price")' });
    expect(findProviderHosts(root, ["lib/fetch-prices.ts"]).map((h) => h.host)).toEqual(["api.coingecko.com"]);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-no-market-data-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the check**

Create `scripts/checks/check-no-market-data-provider.mjs`:

```js
#!/usr/bin/env node
// MarketLens owns market data (E3/E4). This hub consumes it over HTTP via
// src/lib/services/marketlens.ts and never speaks to a price provider directly.
// The one recorded exception is the CoinGecko crypto path, on loan until crypto
// is ported — and it is recorded as a dated registry entry, not as a permanent
// carve-out in this file.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { loadExceptionsFor } from "./check-policy-exception-expiry.mjs";

const PROVIDER_HOSTS = [
  "alphavantage.co",
  "finance.yahoo.com",
  "api.coingecko.com",
  "polygon.io",
  "iexapis.com",
  "twelvedata.com",
  "finnhub.io",
  "data.binance.vision",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx", ".mts"].includes(extname(full))) out.push(full);
  }
  return out;
}

export function findProviderHosts(dir, exemptPaths = []) {
  const exempt = new Set(exemptPaths);
  const hits = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file);
    if (exempt.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const host of PROVIDER_HOSTS) {
      if (text.includes(host)) hits.push({ file: rel, host });
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exempt = loadExceptionsFor("no-market-data-provider").map((e) =>
    e.path.replace(/^src\//, ""),
  );
  const hits = findProviderHosts("src", exempt);
  if (hits.length > 0) {
    console.error("check-no-market-data-provider: this repo is talking to a price provider.");
    for (const h of hits) console.error(`  src/${h.file} -> ${h.host}`);
    console.error("\nMarketLens owns market data (E3/E4). Consume it through");
    console.error("src/lib/services/marketlens.ts. If this is genuinely temporary,");
    console.error("add a dated entry to docs/policies/exceptions.json.");
    process.exit(1);
  }
  console.log("check-no-market-data-provider: no direct provider access");
}
```

- [ ] **Step 4: Add the recorded CoinGecko exception**

Replace `docs/policies/exceptions.json` contents:

```json
[
  {
    "id": "coingecko-crypto-on-loan",
    "check": "no-market-data-provider",
    "path": "src/lib/fetch-prices.ts",
    "why": "Crypto valuation is MarketLens' (ratified 2026-08-18) but not yet built there. This path is on loan until crypto is ported; see ECOSYSTEM.md.",
    "owner": "zub",
    "reviewDate": "2026-11-30"
  }
]
```

- [ ] **Step 5: Add the lint half — package imports**

In `eslint.config.mjs`, inside the existing config object's `rules`, add:

```js
      // E3/E4: market-data ingestion belongs to MarketLens. Consuming its HTTP
      // API is correct; pulling a provider SDK into this repo is not.
      "no-restricted-imports": ["error", {
        paths: [
          { name: "alphavantage", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
          { name: "yahoo-finance2", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
          { name: "@polygon.io/client-js", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
          { name: "finnhub", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
        ],
      }],
```

- [ ] **Step 6: Verify both halves**

Run: `npx vitest run scripts/checks/check-no-market-data-provider.test.ts`
Expected: PASS — 5 tests.

Run: `node scripts/checks/check-no-market-data-provider.mjs`
Expected: PASS, with `src/lib/fetch-prices.ts` exempted by the registry entry.

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 7: Wire in and commit**

`package.json`:

```json
"check:marketdata": "node scripts/checks/check-no-market-data-provider.mjs",
"check": "npm run lint && npm run typecheck && npm run check:env && npm run check:exceptions && npm run check:cards && npm run check:marketdata && npm run test"
```

```bash
git add scripts/checks/check-no-market-data-provider.mjs scripts/checks/check-no-market-data-provider.test.ts eslint.config.mjs docs/policies/exceptions.json package.json
git commit -m "feat(checks): fail the build on direct price-provider access

E3/E4 says MarketLens owns market data and this hub consumes it over HTTP. Two
halves: an eslint no-restricted-imports rule for provider SDKs, and a host scan
for direct URLs. The CoinGecko crypto path becomes the registry's first entry
with a 2026-11-30 review — an exception with a clock rather than a permanent
carve-out written into the checker."
```

---

### Task 6: Compile the honesty invariant — "daily closes, never real-time" (A6)

**Files:**
- Create: `scripts/checks/check-price-honesty-copy.mjs`
- Test: `scripts/checks/check-price-honesty-copy.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `findRealtimeClaims(dir: string): {file: string, line: number, text: string}[]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/checks/check-price-honesty-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRealtimeClaims } from "./check-price-honesty-copy.mjs";

function tree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "honesty-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("findRealtimeClaims", () => {
  it("flags user-facing copy promising real-time prices", () => {
    const root = tree({ "a.tsx": '<p>Real-time prices for your portfolio</p>' });
    expect(findRealtimeClaims(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags the hyphenless spelling", () => {
    const root = tree({ "a.tsx": '<p>realtime quotes</p>' });
    expect(findRealtimeClaims(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows an explicit denial, which is the honest phrasing", () => {
    const root = tree({ "a.tsx": '<p>Daily closes, not real-time prices.</p>' });
    expect(findRealtimeClaims(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("ignores comments, which are not user-facing copy", () => {
    const root = tree({ "a.ts": '// we deliberately do not offer real-time data\nexport const x = 1;' });
    expect(findRealtimeClaims(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-price-honesty-copy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the check**

Create `scripts/checks/check-price-honesty-copy.mjs`:

```js
#!/usr/bin/env node
// A6, the honesty invariant: MarketLens serves daily closes, so the product must
// never say "real-time". This scans user-facing copy only — comments are exempt
// because writing down WHY we don't claim it is the behaviour we want.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const CLAIM = /real[\s-]?time|live price|live quote/i;
// "not real-time" / "never real-time" / "rather than real-time" are denials, not claims.
const DENIAL = /\b(not|never|no|rather than|instead of)\b[^.]{0,24}real[\s-]?time/i;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
  }
  return out;
}

export function findRealtimeClaims(dir) {
  const hits = [];
  for (const file of walk(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      const bare = text.trim();
      if (bare.startsWith("//") || bare.startsWith("*") || bare.startsWith("/*")) return;
      if (CLAIM.test(text) && !DENIAL.test(text)) {
        hits.push({ file: relative(dir, file), line: i + 1, text: bare });
      }
    });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findRealtimeClaims("src");
  if (hits.length > 0) {
    console.error("check-price-honesty-copy: copy claims real-time pricing (A6).");
    for (const h of hits) console.error(`  src/${h.file}:${h.line}  ${h.text}`);
    console.error('\nMarketLens serves daily closes. Say "daily close" or "latest close".');
    process.exit(1);
  }
  console.log("check-price-honesty-copy: no real-time claims");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/checks/check-price-honesty-copy.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Run against the repo and triage**

Run: `node scripts/checks/check-price-honesty-copy.mjs`

If it reports hits, each is either a genuine A6 violation (rewrite the copy to say "daily close") or a false positive (narrow `CLAIM`/`DENIAL`). Do **not** add registry exceptions for copy — an honest phrasing always exists.

- [ ] **Step 6: Wire in and commit**

`package.json`: add `"check:honesty": "node scripts/checks/check-price-honesty-copy.mjs"` and append `&& npm run check:honesty` to `check` before `npm run test`.

```bash
git add scripts/checks/check-price-honesty-copy.mjs scripts/checks/check-price-honesty-copy.test.ts package.json
git commit -m "feat(checks): the product may not claim real-time pricing (A6)

MarketLens serves daily closes. Comments are exempt: writing down why we don't
claim real-time is the behaviour we want, so only user-facing copy is scanned,
and explicit denials pass."
```

---

### Task 7: Compile the three behavioural invariants as tests

Three of the four remaining invariants become assertions in the existing suites. The fourth — `tradeDate >= expectedSession`, never `===` — is **already compiled**: `src/lib/domain/investments/refreshHoldingPrices.test.ts` asserts *"validates a quote from a session at or after the one MarketLens expected"*. Cite it in the ledger; write no new test for it.

**Files:**
- Modify: `src/lib/domain/investments/refreshHoldingPrices.test.ts` (add one case)
- Modify: `src/engine/balance.test.ts` (add a `holdingsValuation` describe block)
- Create: `scripts/checks/check-no-key-leakage.mjs`
- Test: `scripts/checks/check-no-key-leakage.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `refreshHoldingPrices(prisma, userId, options)` from `src/lib/domain/investments/refreshHoldingPrices.ts`; `holdingsValuation(holdings, accountCurrency, rates?)` from `src/engine/balance.ts`.
- Produces: `findKeyLeaks(dir: string): {file: string, line: number, text: string}[]`.

- [ ] **Step 1: Read the two existing test files before editing**

Run: `sed -n '1,60p' src/lib/domain/investments/refreshHoldingPrices.test.ts` and `sed -n '1,40p' src/engine/balance.test.ts`

Match their existing mock setup and import style exactly — do not invent a new harness.

- [ ] **Step 2: Add the "untouched on failure" case (E4)**

Append inside the existing top-level `describe` in `refreshHoldingPrices.test.ts`, reusing that file's established prisma mock:

```ts
  it("leaves stored prices untouched when the fetch learns nothing", async () => {
    // E4: a refresh that learns nothing changes nothing. The FX cron behaves the
    // same way on an empty fetch. A price wrongly zeroed is worse than a stale one.
    const update = vi.fn();
    const prisma = holdingPrismaStub({ update });
    vi.mocked(fetchQuotes).mockRejectedValueOnce(new Error("provider deadline exceeded"));

    const outcome = await refreshHoldingPrices(prisma, "user-1");

    expect(outcome.ok).toBe(false);
    expect(outcome.updated).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
```

If this file's stub helper is named differently, use its real name — `holdingPrismaStub` above is a placeholder for whatever Step 1 revealed, and the step is not done until the call compiles.

- [ ] **Step 3: Add the currency-exclusion cases**

Append to `src/engine/balance.test.ts`:

```ts
describe("holdingsValuation", () => {
  it("excludes a holding whose currency it cannot convert, and returns it", () => {
    // A price without a currency must not be summed. The UI has to disclose the gap
    // rather than quietly under-reporting the total.
    const result = holdingsValuation(
      [
        { quantity: 10, lastPriceMinor: 1_000, priceCurrency: "CAD" },
        { quantity: 5, lastPriceMinor: 2_000, priceCurrency: "JPY" },
      ],
      "CAD",
      [],
    );

    expect(result.valueMinor).toBe(10_000);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].priceCurrency).toBe("JPY");
  });

  it("reads a null priceCurrency as the account currency while saying so", () => {
    // null means "entered by hand before currencies were tracked" — never
    // "the provider didn't say", because provider prices always carry one.
    const result = holdingsValuation(
      [{ quantity: 2, lastPriceMinor: 5_000, priceCurrency: null }],
      "CAD",
      [],
    );

    expect(result.valueMinor).toBe(10_000);
    expect(result.assumedCurrency).toHaveLength(1);
  });
});
```

Adjust the object shape to the real `HoldingForValuation` type — read it from `src/engine/balance.ts:185` first. Field names above must match the type or the test will not compile.

- [ ] **Step 4: Run both suites**

Run: `npx vitest run src/lib/domain/investments/refreshHoldingPrices.test.ts src/engine/balance.test.ts`
Expected: PASS, with 3 more cases than before.

- [ ] **Step 5: Write the failing test for the BYOK guard**

Create `scripts/checks/check-no-key-leakage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findKeyLeaks } from "./check-no-key-leakage.mjs";

function tree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "leak-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("findKeyLeaks", () => {
  it("flags logging a decrypted provider key", () => {
    const root = tree({ "a.ts": "const providerKey = await readProviderKeys();\nconsole.log(providerKey);" });
    expect(findKeyLeaks(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a provider key placed in a query string", () => {
    const root = tree({ "a.ts": "redirect(`/done?providerKey=${providerKey}`);" });
    expect(findKeyLeaks(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows the key riding one outbound header, which is its whole purpose", () => {
    const root = tree({ "a.ts": 'headers.set("X-Provider-Key", `${provider}=${providerKey}`);' });
    expect(findKeyLeaks(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-no-key-leakage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the guard**

Create `scripts/checks/check-no-key-leakage.mjs`:

```js
#!/usr/bin/env node
// BYOK keys live here encrypted (src/lib/security/providerKeys.ts) and are
// decrypted only to ride one outbound header. They are never logged, echoed, or
// placed in a redirect query string — a URL lands in browser history, server
// logs and any referrer.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const KEY = "(providerKey|decryptedKey|providerSecret)";
const LEAKS = [
  new RegExp(`console\\.(log|info|warn|error|debug)\\([^)]*${KEY}`, "i"),
  new RegExp(`[?&][A-Za-z]*[Kk]ey=\\$\\{[^}]*${KEY}`, "i"),
  new RegExp(`(logger|log)\\.[a-z]+\\([^)]*${KEY}`, "i"),
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
  }
  return out;
}

export function findKeyLeaks(dir) {
  const hits = [];
  for (const file of walk(dir)) {
    readFileSync(file, "utf8").split("\n").forEach((text, i) => {
      if (LEAKS.some((re) => re.test(text))) {
        hits.push({ file: relative(dir, file), line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findKeyLeaks("src");
  if (hits.length > 0) {
    console.error("check-no-key-leakage: a BYOK provider key may be escaping.");
    for (const h of hits) console.error(`  src/${h.file}:${h.line}  ${h.text}`);
    console.error("\nA decrypted key rides one outbound header and nothing else.");
    process.exit(1);
  }
  console.log("check-no-key-leakage: no provider key leaks");
}
```

- [ ] **Step 8: Verify, wire in, commit**

Run: `npx vitest run scripts/checks/check-no-key-leakage.test.ts` — expected PASS (3 tests).
Run: `node scripts/checks/check-no-key-leakage.mjs` — expected PASS.

`package.json`: add `"check:keys": "node scripts/checks/check-no-key-leakage.mjs"` and append `&& npm run check:keys` to `check` before `npm run test`.

```bash
git add src/lib/domain/investments/refreshHoldingPrices.test.ts src/engine/balance.test.ts scripts/checks/check-no-key-leakage.mjs scripts/checks/check-no-key-leakage.test.ts package.json
git commit -m "test(invariants): assert untouched-on-failure, currency exclusion, no key leaks

Three prose invariants become assertions. tradeDate >= expectedSession was
already covered by refreshHoldingPrices.test.ts and needed no new test — the
ledger cites the existing case rather than duplicating it."
```

---

### Task 8: `REPO_MAP.md`, the docs/scripts consolidation, and a root-cleanliness check

Closes G13 (two competing plan directories) and G14 (a flat 19-file `scripts/` drawer with duplicates and scratch).

**Files:**
- Create: `REPO_MAP.md`
- Create: `scripts/checks/check-repo-layout.mjs`
- Test: `scripts/checks/check-repo-layout.test.ts`
- Move: `docs/plans/*` → `docs/superpowers/plans/`
- Move: `scripts/*` into buckets
- Modify: `package.json`

**Interfaces:**
- Produces: `findStrayFiles(root: string): string[]` — files directly under `scripts/` that are not in a bucket, and any new top-level directory under `docs/`.

- [ ] **Step 1: Consolidate the plan directories**

```bash
git mv docs/plans/* docs/superpowers/plans/
rmdir docs/plans
grep -rln "docs/plans/" docs/ src/ *.md 2>/dev/null || true
```

Update any references the grep finds to `docs/superpowers/plans/`.

- [ ] **Step 2: Bucket the scripts, and list the dead ones for confirmation**

Create the buckets and move the live scripts:

```bash
mkdir -p scripts/checks scripts/sync scripts/seeds scripts/generators scripts/ops
git mv scripts/sync-contracts.sh scripts/sync-ecosystem.sh scripts/sync/
git mv scripts/seed-owner-state.ts scripts/seeds/
git mv scripts/download-real-card-photos.ts scripts/generate-photorealistic-cards.ts \
       scripts/generate-starter-card-assets.ts scripts/upload-cards-to-r2.ts scripts/generators/
git mv scripts/qstash-schedules.mjs scripts/qstash-schedules.config.mjs \
       scripts/qstash-schedules.config.test.ts scripts/qstash-check.mjs \
       scripts/report-price-currency-drift.mjs scripts/ops/
git mv scripts/importLooplyExport.ts scripts/importLooplyExport.test.ts scripts/ops/
```

**Then STOP and report this list to the user before deleting anything:**

- `scripts/check-db.mjs` and `scripts/check-db.ts` — duplicate implementations of the same probe
- `scripts/check-ml.mjs` and `scripts/check-ml2.mjs` — MarketLens connectivity scratch; `check-ml2` is an unlabelled second attempt
- `scripts/fixture.json` — orphaned fixture with no reader

Deletion needs explicit confirmation. If the user declines, `git mv` them to `scripts/archive/` instead.

- [ ] **Step 3: Fix the paths the moves broke**

```bash
grep -rn "scripts/qstash-schedules\|scripts/sync-contracts\|scripts/sync-ecosystem\|scripts/importLooplyExport" package.json .github/ docs/ *.md src/ 2>/dev/null
```

Update every hit — `package.json` scripts and `.github/workflows/ci.yml` both reference these paths. Then run `npm run check` to confirm nothing dangles.

- [ ] **Step 4: Write the failing test**

Create `scripts/checks/check-repo-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findStrayFiles } from "./check-repo-layout.mjs";

function repo(paths: string[]) {
  const root = mkdtempSync(join(tmpdir(), "layout-"));
  for (const rel of paths) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "");
  }
  return root;
}

describe("findStrayFiles", () => {
  it("flags a script dropped directly into scripts/", () => {
    const root = repo(["scripts/checks/a.mjs", "scripts/quick-fix.ts"]);
    expect(findStrayFiles(root)).toEqual(["scripts/quick-fix.ts"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts scripts inside known buckets", () => {
    const root = repo(["scripts/checks/a.mjs", "scripts/sync/b.sh", "scripts/ops/c.mjs"]);
    expect(findStrayFiles(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags an unrecognised top-level docs directory", () => {
    const root = repo(["docs/decisions/a.md", "docs/analysis/b.md"]);
    expect(findStrayFiles(root)).toEqual(["docs/analysis"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a README directly under scripts/", () => {
    const root = repo(["scripts/README.md", "scripts/checks/a.mjs"]);
    expect(findStrayFiles(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-repo-layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Write the check**

Create `scripts/checks/check-repo-layout.mjs`:

```js
#!/usr/bin/env node
// Agents create files constantly. Without a single-valued answer to "where does
// this go", every session invents its own layout — which is how docs/plans/ and
// docs/superpowers/plans/ came to coexist. REPO_MAP.md is that answer; this is
// its enforcement.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_BUCKETS = ["checks", "sync", "seeds", "generators", "ops", "archive"];
const SCRIPT_FILES_OK = ["README.md"];
const DOCS_DIRS = ["decisions", "policies", "runbooks", "superpowers", "reports", "private", "archive"];

export function findStrayFiles(root) {
  const stray = [];
  const scripts = join(root, "scripts");
  if (existsSync(scripts)) {
    for (const entry of readdirSync(scripts)) {
      const full = join(scripts, entry);
      if (statSync(full).isDirectory()) {
        if (!SCRIPT_BUCKETS.includes(entry)) stray.push(`scripts/${entry}`);
      } else if (!SCRIPT_FILES_OK.includes(entry)) {
        stray.push(`scripts/${entry}`);
      }
    }
  }
  const docs = join(root, "docs");
  if (existsSync(docs)) {
    for (const entry of readdirSync(docs)) {
      if (!statSync(join(docs, entry)).isDirectory()) continue;
      if (!DOCS_DIRS.includes(entry)) stray.push(`docs/${entry}`);
    }
  }
  return stray.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stray = findStrayFiles(".");
  if (stray.length > 0) {
    console.error("check-repo-layout: these do not have a home in REPO_MAP.md:");
    for (const s of stray) console.error(`  ${s}`);
    console.error("\nPick an existing bucket. If none fits, that is a signal to write");
    console.error("an ADR in docs/decisions/ proposing a new one — not to add it silently.");
    process.exit(1);
  }
  console.log("check-repo-layout: every artifact is in a known bucket");
}
```

- [ ] **Step 7: Write `REPO_MAP.md`**

Create `REPO_MAP.md`:

```markdown
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

Every new check needs its own test and its CI trigger **in the same commit** — see
the `add-a-check` skill.
```

- [ ] **Step 8: Verify, wire in, commit**

Run: `npx vitest run scripts/checks/check-repo-layout.test.ts` — expected PASS (4 tests).
Run: `node scripts/checks/check-repo-layout.mjs` — expected PASS after Steps 1–3.
Run: `npm run check` — expected PASS.

`package.json`: add `"check:layout": "node scripts/checks/check-repo-layout.mjs"` and append `&& npm run check:layout` to `check` before `npm run test`.

```bash
git add -A REPO_MAP.md scripts/ docs/ package.json
git commit -m "feat(layout): REPO_MAP as the single-valued answer to where things go

docs/plans/ and docs/superpowers/plans/ had both become plan homes, and scripts/
was a flat 19-file drawer holding duplicates and scratch beside load-bearing
sync and cron code. Buckets both, and enforce it — the map is only worth writing
if something fails when it is ignored."
```

---

### Task 9: Demote the seven uncompilable invariants

P2: nothing is deleted, and nothing uncompiled keeps paying per-turn rent. Each demoted invariant lands in a linked file and is reached by exactly one router line in Task 10.

**Files:**
- Create: `docs/policies/card-ownership.md`
- Create: `docs/policies/marketlens.md`
- Create: `docs/runbooks/quote-cache.md`

**Interfaces:**
- Produces: three markdown files, linked (never `@`-imported) from `AGENTS.md` in Task 10.

- [ ] **Step 1: Extract the card-ownership prose**

Create `docs/policies/card-ownership.md`. Move the *reasoning* out of `CLAUDE.md` verbatim — the incident history is genuinely valuable, it just should not load on every turn:

```markdown
# Card ownership (C1, D3)

**Read when:** touching cards, the catalogue, `src/engine/cards-twin/`, or `CreditCard`.
**Enforced by:** `npm run check:cards`.

## The line

The catalogue says what the **card** is. `CreditCard` says what the **user's copy**
is — nickname, lastFour, limit, statement/due day, APR, fee dates, `feeRebateMinor`.

Card facts resolve from `contracts/card-catalogue.json` through
`src/lib/cards/catalogueCard.ts`, keyed by `CreditCard.contractCardId`.

`annualFeeMinor` and `feeRebateMinor` live on the per-user row deliberately: a fee
is a term of the owner's account, and the rebate is their banking package — Scotia's
Ultimate rebates up to $150 where Preferred rebates $40, so only the owner can say
which they hold. No figure is ever inferred from the catalogue's `fee.waiver` prose.

## Why the check exists

This drift has happened twice. First `src/engine/cards/` — a frozen engine, deleted.
Then a larger, later-found twin: `src/lib/cards/presets.ts` + `CreditCard.rewards` +
`CardRewards` + a 1,460-line rewards editor, a second hand-authored rate model for
the same 27 cards. Prose caught neither. See `docs/decisions/LOG.md` 2026-08-19.

## What exists here

`src/engine/cards-twin/` — the C1-authorized TypeScript twin: `RuleMatcher`,
`CapMath`, `Scorer`, `RecommendationEngine`, and nothing else. Do not widen it
beyond C1's scope, and do not add rule-model features, categories, or picker
capabilities anywhere in this repo.

Swift stays canonical. Contract changes land in Swift + fixtures first; the shared
fixture suite gates both languages (`engine-fixtures-ts`). A card not in the
catalogue goes through `/cards/request` (D3), never a hand-authored rate.

## Syncing contracts

Use the `contract-sync` skill. The short version: commit in PickMe first, then
`./scripts/sync/sync-contracts.sh`. The script refuses a dirty PickMe tree, because
a manifest recording "PickMe at <sha> had <bytes>" for a pairing that never existed
is worse than no manifest — that happened on 2026-08-24.
```

- [ ] **Step 2: Extract the MarketLens prose**

Create `docs/policies/marketlens.md`:

```markdown
# Market data (E3, E4, A6)

**Read when:** touching prices, holdings, valuation, or FX.
**Enforced by:** `npm run check:marketdata`, `npm run check:honesty`, and tests in
`src/engine/balance.test.ts` and `src/lib/domain/investments/`.

MarketLens owns market data. Consume it over HTTP via `src/lib/services/marketlens.ts`.
Never add a price provider, indicator, or ingestion path here.

- **Daily closes, never real-time** (A6). Say it that way in every surface.
- **A refresh that learns nothing changes nothing** (E4). `refreshHoldingPrices`
  leaves stored prices untouched on any failure, exactly as the FX cron leaves rates
  untouched on an empty fetch. Prices cache in `Holding.lastPriceMinor` and render
  with their real age.
- **A price without a currency must not be summed.** `Holding.priceCurrency` null
  means "entered by hand before currencies were tracked" and is read as the account's
  currency *while saying so*. Provider prices always carry a currency, so null can
  never silently mean "the provider didn't say". `holdingsValuation()` excludes
  mismatched-currency holdings and returns them, so the UI must disclose them.
- **Validation is `tradeDate >= expectedSession`, never `===`.** Two independently
  deployed services must not have to agree on a calendar date for a valuation to count.
- **Scope:** investment tracking is v1 (E2). Net worth, forecasting, and bank
  aggregation are not. Engine code existing without a UI is not authorization —
  `src/engine/networth.ts`, `billforecast.ts`, `taxchecklist.ts` are all in that state.
- **BYOK keys** live here encrypted (`src/lib/security/providerKeys.ts`,
  `secretCrypto` envelopes), never in MarketLens. Decrypted only to ride one outbound
  header. Never logged, echoed, or placed in a redirect query string — enforced by
  `npm run check:keys`.

## Recorded exception

The CoinGecko crypto path in `src/lib/fetch-prices.ts` is on loan until crypto is
ported to MarketLens (ratified 2026-08-18). It is a dated entry in
`docs/policies/exceptions.json`, reviewed 2026-11-30 — not a permanent carve-out.
```

- [ ] **Step 3: Extract the quote-cache runbook**

Create `docs/runbooks/quote-cache.md`. This is the ~450-word block that costs the most per turn:

```markdown
# Runbook — the quote cache and its warm-up

**Read when:** changing a cron, the quote path, or price alerting.
**Asserted by:** `scripts/ops/qstash-schedules.config.test.ts`.

## What went wrong, once

MarketLens serves quotes from a cache and only fans out to its upstream provider on
a miss. That fan-out is the expensive, deadline-bound step, and whoever triggers the
first one of the night pays for it. The loser of that race is served a cached price
**indistinguishable from a fresh one** — which is how the price cron ran one session
stale every night for weeks with no error at either end (`LOG.md` 2026-08-27).

## The fixed order

1. `cron/prices-warmup` at 01:45 UTC runs `warmQuoteCache`, forcing a provider
   fan-out for our own held symbols via `/api/v1/quotes?...&refresh=true`.
2. `cron/prices` at 02:00 UTC repeats it as a backstop, then reads.

**Do not reschedule the warm-up after the read.** **Do not "simplify" it to a
health-endpoint ping** — waking the HTTP layer proves nothing about the fan-out.
The ordering is asserted in `scripts/ops/qstash-schedules.config.test.ts`, not just
described here.

**Never point a warm-up at MarketLens' `/api/v1/admin/**` sweep.** That path is
`hasRole("ADMIN")`, this app holds a USER key, and the answer to the 403 is not to
hand the hub an admin key.

## Reading a non-FRESH quote

MarketLens now reports *why* a quote is not FRESH: `provider_deadline_exceeded`,
`budget_exhausted`, `session_in_progress`, and others. Carry that cause into alerts
rather than reporting "nothing worked". Keep the vocabulary in sync with MarketLens'
`QuoteService`.
```

- [ ] **Step 4: Verify every demoted claim still has a home**

Run: `grep -c '^' docs/policies/card-ownership.md docs/policies/marketlens.md docs/runbooks/quote-cache.md`

Read the current `CLAUDE.md` side by side with these three files. Every bullet must appear in exactly one of: a check (Tasks 4–7), one of these files, or the router's identity lines (Task 10). Nothing may be dropped.

- [ ] **Step 5: Commit**

```bash
git add docs/policies/card-ownership.md docs/policies/marketlens.md docs/runbooks/quote-cache.md
git commit -m "docs(policies): demote the seven uncompilable invariants to linked files

Nothing is lost — the incident histories are the most valuable prose in the repo.
They just stop loading on every turn and start loading when someone is actually
in that code. The quote-cache runbook alone is ~450 words that were costing every
task, including tasks that never touch a cron."
```

---

### Task 10: The router — `AGENTS.md` canonical

The payoff. Closes G1, and the token budget becomes a test so it cannot quietly regress.

**Files:**
- Create: `AGENTS.md` (replacing the Next.js-only content, preserving its markers)
- Modify: `CLAUDE.md` (shrink to a pointer)
- Modify: `ECOSYSTEM.md` reference — link, never `@`-import
- Test: `scripts/checks/check-router-budget.test.ts`

**Interfaces:**
- Produces: `AGENTS.md` ≤ 40 lines of our content; combined always-loaded budget ≤ 2,400 characters (~600 tokens).

- [ ] **Step 1: Write the failing budget test**

Create `scripts/checks/check-router-budget.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The whole milestone exists to shrink this. A test, not a hope.
const BUDGET_CHARS = 2400; // ~600 tokens at 4 chars/token

function ourContent(path: string): string {
  const text = readFileSync(path, "utf8");
  // The Next.js block is regenerated by `next dev` and is not ours to shrink.
  return text.replace(/<!-- BEGIN:nextjs-agent-rules -->[\s\S]*?<!-- END:nextjs-agent-rules -->/g, "");
}

describe("always-loaded agent context", () => {
  it("keeps AGENTS.md within 40 lines of our own content", () => {
    const lines = ourContent("AGENTS.md").split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(40);
  });

  it("keeps the combined always-loaded budget under 2400 characters", () => {
    const total = ourContent("AGENTS.md").length + ourContent("CLAUDE.md").length;
    expect(total).toBeLessThanOrEqual(BUDGET_CHARS);
  });

  it("never @-imports ECOSYSTEM.md, which would load it eagerly on every turn", () => {
    const combined = readFileSync("AGENTS.md", "utf8") + readFileSync("CLAUDE.md", "utf8");
    expect(combined).not.toMatch(/^@ECOSYSTEM\.md/m);
  });

  it("reaches each demoted policy by a markdown link", () => {
    const text = readFileSync("AGENTS.md", "utf8");
    for (const target of [
      "REPO_MAP.md",
      "docs/policies/card-ownership.md",
      "docs/policies/marketlens.md",
      "docs/runbooks/quote-cache.md",
      "docs/policies/exceptions.json",
    ]) {
      expect(text).toContain(`(${target})`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/checks/check-router-budget.test.ts`
Expected: FAIL — `AGENTS.md` is currently Next.js boilerplate with no links, and `CLAUDE.md` is ~9KB combined.

- [ ] **Step 3: Write the router**

Replace `AGENTS.md`, keeping the Next.js block untouched at the bottom:

```markdown
# In Unity — agent router

The financial command center of a four-product ecosystem. `MoneyTalks` is the
working repo name; the product is **In Unity** (`inunity.ca`).

**This repo must not own** card rate semantics (PickMe owns them, C1/D3) or
market-data ingestion (MarketLens owns it, E3/E4). Both are enforced by
`npm run check`, not merely requested.

## One command

```
npm run check
```

Lint, typecheck, env, guardrails and the unit suite — well under a minute. **It is
the checklist.** There is no other checklist. Also: `npm run dev`,
`npm run e2e` (needs Postgres + Clerk dev keys), `npx prisma migrate dev`.

## Read when you are…

| File | …doing this |
|---|---|
| [`REPO_MAP.md`](REPO_MAP.md) | creating any file under `docs/` or `scripts/` |
| [`card-ownership.md`](docs/policies/card-ownership.md) | touching cards, the catalogue, or the twin |
| [`marketlens.md`](docs/policies/marketlens.md) | touching prices, holdings, valuation, or FX |
| [`quote-cache.md`](docs/runbooks/quote-cache.md) | changing a cron or the quote path |
| [`exceptions.json`](docs/policies/exceptions.json) | a check is wrong for your task — add a dated entry and keep moving |
| [`LOG.md`](docs/decisions/LOG.md) | cross-cutting work |
| [`ECOSYSTEM.md`](ECOSYSTEM.md) | anything spanning repos |
| [`FLEET.md`](FLEET.md) | recommending which model and effort to run a task at |

## Freedom

Anything not named here and not caught by `npm run check` is yours to decide.
Prefer acting and letting the check fail over asking.
```

- [ ] **Step 4: Shrink `CLAUDE.md` to a pointer**

Replace `CLAUDE.md` entirely with:

```markdown
@AGENTS.md
```

- [ ] **Step 5: Verify the budget test passes**

Run: `npx vitest run scripts/checks/check-router-budget.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Measure the real reduction**

```bash
node -e "const fs=require('fs');const s=['AGENTS.md','CLAUDE.md'].map(f=>fs.readFileSync(f,'utf8').length).reduce((a,b)=>a+b);console.log('chars',s,'~tokens',Math.round(s/4))"
```

Expected: ~600 tokens or fewer, down from 2,285. Record the number in the commit message.

- [ ] **Step 7: Confirm nothing was silently dropped**

```bash
git show HEAD~1:CLAUDE.md > /tmp/old-claude.md
```

Read `/tmp/old-claude.md` bullet by bullet. Every one must map to a check, a demoted file from Task 9, or a router line. If any is homeless, add it to the right policy file before committing.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md CLAUDE.md scripts/checks/check-router-budget.test.ts
git commit -m "feat(agents): AGENTS.md becomes the canonical router

Codex, Gemini and Copilot read AGENTS.md and ignore CLAUDE.md, so this repo's
ownership boundaries were invisible to three of four vendors — while CLAUDE.md
paid tokens every turn to @-import a Next.js notice. Now one router serves every
vendor, and CLAUDE.md is a single @-import of it.

ECOSYSTEM.md is reached by a markdown link rather than @, which loads eagerly:
that one change is most of the reduction. A test holds the budget at 40 lines and
2400 characters so it cannot creep back."
```

---

### Task 11: `.claude/settings.json` and the four repo-local skills

**Files:**
- Create: `.claude/settings.json`
- Create: `.claude/skills/contract-sync/SKILL.md`
- Create: `.claude/skills/cron-schedule-change/SKILL.md`
- Create: `.claude/skills/add-a-check/SKILL.md`
- Create: `.claude/skills/release-deploy/SKILL.md`
- Modify: `.gitignore` (ensure `settings.local.json` stays ignored, `settings.json` does not)

**Interfaces:**
- Produces: four skills, each with `name` and `description` frontmatter. The description drives when the skill loads, so it must name the trigger, not the topic.

- [ ] **Step 1: Check in a permission allowlist**

Create `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run check)",
      "Bash(npm run check:*)",
      "Bash(npm run lint)",
      "Bash(npm run test)",
      "Bash(npm run typecheck)",
      "Bash(npx vitest run:*)",
      "Bash(npx tsc --noEmit)",
      "Bash(npx prisma generate)",
      "Bash(node scripts/checks/*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)"
    ]
  }
}
```

Read-only and verification commands only. Nothing that writes to a remote, mutates a database, or deletes.

- [ ] **Step 2: Confirm `.gitignore` keeps the split right**

```bash
git check-ignore -v .claude/settings.json || echo "settings.json is tracked — correct"
git check-ignore -v .claude/settings.local.json && echo "settings.local.json ignored — correct"
```

If `settings.json` is ignored, narrow the `.gitignore` rule from `.claude/` to `.claude/settings.local.json` and `.claude/worktrees/`.

- [ ] **Step 3: Write the `contract-sync` skill**

Create `.claude/skills/contract-sync/SKILL.md`:

```markdown
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
```

- [ ] **Step 4: Write the `cron-schedule-change` skill**

Create `.claude/skills/cron-schedule-change/SKILL.md`:

```markdown
---
name: cron-schedule-change
description: Use when changing a scheduled job, the QStash schedule config, the price or FX cron, or the MarketLens quote warm-up — including any change to their timing or order.
---

# Changing a scheduled job

Read [`docs/runbooks/quote-cache.md`](../../../docs/runbooks/quote-cache.md) first.
It explains why the warm-up precedes the read, and what a nightly failure looked
like when it did not.

## Rules

- **Warm-up before read, always.** `cron/prices-warmup` (01:45 UTC) forces a
  provider fan-out; `cron/prices` (02:00 UTC) repeats it as a backstop, then reads.
  Do not reorder. Do not reduce the warm-up to a health-endpoint ping.
- **Never target `/api/v1/admin/**`.** That path needs an ADMIN role; this app holds
  a USER key. The answer to the 403 is not an admin key.
- **Assert, do not describe.** Ordering lives in
  `scripts/ops/qstash-schedules.config.test.ts`. Any timing change updates that test
  in the same commit.

## Steps

1. Edit `scripts/ops/qstash-schedules.config.mjs`.
2. Update `scripts/ops/qstash-schedules.config.test.ts` to assert the new ordering.
3. `npx vitest run scripts/ops/qstash-schedules.config.test.ts`
4. `npm run check`
5. Apply with `npm run qstash:schedules`; confirm with `npm run qstash:check`.
```

- [ ] **Step 5: Write the `add-a-check` skill**

Create `.claude/skills/add-a-check/SKILL.md`:

```markdown
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
```

- [ ] **Step 6: Write the `release-deploy` skill**

Create `.claude/skills/release-deploy/SKILL.md`:

```markdown
---
name: release-deploy
description: Use when shipping to production, checking how a change reaches users, running a database migration against production, or investigating a deploy.
---

# How a change reaches production

Vercel deploys from GitHub. There is no deploy workflow in `.github/workflows/` —
pushing to `main` is the deploy.

`package.json`'s `build` is `prisma migrate deploy && next build`, so **migrations
run as part of the build**. A migration that fails fails the deploy; it does not
half-apply and continue.

## Before pushing to main

1. `npm run check` — green.
2. If the change touches `prisma/schema.prisma`, confirm a migration exists:
   `npx prisma migrate status`.
3. If it touches a cron, use the `cron-schedule-change` skill.
4. If it touches `contracts/`, use the `contract-sync` skill.

## After

- Sentry is wired in three configs (`sentry.client|edge|server.config.ts`). Check it
  before declaring a deploy healthy.
- The price and FX crons run on QStash, not Vercel Cron. `npm run qstash:check`
  reports what is actually scheduled.

## Secrets

Production env vars live in Vercel, never in the repo. `.env.example` documents every
variable the code reads and `npm run check:env` fails when one is missing — add the
name and a comment there, never a value.
```

- [ ] **Step 7: Verify and commit**

Run: `npm run check` — expected PASS.

```bash
git add .claude/settings.json .claude/skills .gitignore
git commit -m "feat(agents): check in a permission allowlist and four repo-local skills

The allowlist covers read-only and verification commands, so sessions stop
re-prompting for npm run check. The skills are the on-demand home for procedure
that would otherwise sit in the router: contract-sync, cron-schedule-change,
add-a-check, release-deploy. add-a-check encodes the no-check-without-a-trigger
rule, which makes it self-enforcing."
```

---

### Task 12: PR gating — required checks and auto-merge

Converts branch protection from decorative to real. Today all four inspected repos have protection enabled with **zero** required status checks, which is why red main went unnoticed.

**Files:**
- Modify: `.github/workflows/ci.yml`
- GitHub settings (via `gh api`)

**Interfaces:**
- Produces: CI job named `verify` (required) running `npm run check`; `engine-fixtures-ts` (required); `contracts-freshness` (advisory, never required).

- [ ] **Step 1: Restructure CI into tiers**

Rewrite the `test` job in `.github/workflows/ci.yml` as `verify`:

```yaml
  verify:
    name: verify (required)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run check
```

Leave `engine-fixtures-ts` as it is. Leave `contracts-freshness` as it is, and add a comment above it:

```yaml
  # ADVISORY — never a required check. By design this goes red whenever PickMe
  # moves ahead of a MoneyTalks re-sync; that is the signal. Requiring it would
  # freeze all work here every time PickMe edits a contract.
```

- [ ] **Step 2: Push and confirm the job names GitHub sees**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: collapse lint+test into one required verify job running npm run check"
git push
gh run list --limit 1
gh api repos/zubairmuwwakil/MoneyTalks/commits/main/check-runs -q '.check_runs[].name'
```

Record the exact names — required contexts must match them character for character.

- [ ] **Step 3: Require them**

```bash
gh api -X PUT repos/zubairmuwwakil/MoneyTalks/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=verify (required)' \
  -f 'required_status_checks[contexts][]=engine-fixtures-ts' \
  -f 'enforce_admins=false' \
  -f 'required_pull_request_reviews[required_approving_review_count]=0' \
  -F 'restrictions=null'
```

`required_approving_review_count=0` is deliberate: a solo developer cannot approve their own PR, and the checks are the review. `enforce_admins=false` leaves an escape hatch for a genuine emergency.

- [ ] **Step 4: Enable auto-merge**

```bash
gh api -X PATCH repos/zubairmuwwakil/MoneyTalks -f allow_auto_merge=true -f delete_branch_on_merge=true
```

- [ ] **Step 5: Prove the gate works**

```bash
git switch -c test/gating-proof
printf '\nexport const DELIBERATE_TYPE_ERROR: number = "not a number";\n' >> src/engine/balance.ts
git commit -am "test: deliberate type error to prove the gate blocks"
git push -u origin test/gating-proof
gh pr create --title "Prove the gate blocks" --body "Deliberate type error. Expect verify to fail and merge to be blocked."
```

Wait for CI. Expected: `verify (required)` **fails** on typecheck, and the PR reports merging is blocked.

- [ ] **Step 6: Clean up the proof**

```bash
gh pr close --delete-branch
git switch main
git branch -D test/gating-proof
```

- [ ] **Step 7: Record the new workflow in the router**

Append to `AGENTS.md` under **Freedom**, keeping within the 40-line budget:

```markdown
Work on a branch and open a PR; it auto-merges when `verify` is green.
```

Run `npx vitest run scripts/checks/check-router-budget.test.ts` — must still pass.

```bash
git add AGENTS.md
git commit -m "docs(agents): name the PR flow in the router"
git push
```

---

### Task 13: e2e nightly

**Blocked precondition:** `CLERK_TEST_SECRET_KEY` and `NEXT_PUBLIC_CLERK_TEST_PUBLISHABLE_KEY` must exist as repository secrets on `zubairmuwwakil/MoneyTalks`, taken from the Clerk **development** instance. Confirm with `gh secret list -R zubairmuwwakil/MoneyTalks` before starting. If absent, skip this task and report it.

**Files:**
- Create: `.github/workflows/e2e-nightly.yml`

- [ ] **Step 1: Confirm the secrets exist**

Run: `gh secret list -R zubairmuwwakil/MoneyTalks`
Expected: both names present. If not, **stop** — this task cannot proceed.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/e2e-nightly.yml`:

```yaml
# ADVISORY, never required. Playwright spawns a dev server, needs Postgres, and
# does real network round-trips to a Clerk development instance with workers: 1
# and 60s timeouts — none of which belongs in a tier that gates a merge.
name: E2E (nightly)

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: moneytalks_e2e
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
        ports:
          - 5432:5432
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/moneytalks_e2e
      CLERK_TEST_SECRET_KEY: ${{ secrets.CLERK_TEST_SECRET_KEY }}
      NEXT_PUBLIC_CLERK_TEST_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_TEST_PUBLISHABLE_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 3: Run it once by hand**

```bash
git add .github/workflows/e2e-nightly.yml
git commit -m "ci: run the seven Playwright specs nightly

They have never run in CI. Advisory tier: a dev server, a Postgres service and
real Clerk round-trips at workers:1 do not belong in a tier that gates merges."
git push
gh workflow run "E2E (nightly)" -R zubairmuwwakil/MoneyTalks
```

Watch it. If specs fail, that is information about seven tests that have never run — triage each, and do **not** silence them to make the job green.

---

## Self-Review

**Spec coverage.** §1 canonical AGENTS.md → Task 10. §2 router contract → Task 10.
§3 invariant ledger → Tasks 4–7 (8 compiled: cards, market-data, honesty,
untouched-on-failure, currency exclusion, key leakage, plus the already-compiled
`tradeDate >=`, plus layout). §4 de-ceremony and freedom clause → Tasks 2 and 10.
§5 PR flow, tiers, exception registry → Tasks 3 and 12. §6 universals → Tasks 8 and 11.
§7 cross-repo freshness → **deferred to M6**, as the spec sequences it. §8 FLEET.md →
**M4**, where it is authored; Task 10 links it forward. §9 verification depth → Tasks
1, 12, 13; Dependabot is M6. §10 cold-start → Task 1.

**Known forward references.** Task 10's router links `FLEET.md`, which M4 creates. The
link is intentional and will 404 until then — noted so no one "fixes" it by deleting
the row.

**Placeholder scan.** One deliberate marker: Task 7 Step 2's `holdingPrismaStub` is
named as a placeholder for whatever the existing file uses, with an explicit
instruction to read the file first and an acceptance condition that the call must
compile. Every other step carries literal content.

**Type consistency.** `findUndocumentedEnvVars`, `findExpiredExceptions`,
`loadExceptionsFor`, `findRateFields`, `findRateModules`, `findProviderHosts`,
`findRealtimeClaims`, `findKeyLeaks`, `findStrayFiles` — each defined once and
referenced under the same name. `loadExceptionsFor` is defined in Task 3 and consumed
in Tasks 4 and 5 with the signature declared there.
