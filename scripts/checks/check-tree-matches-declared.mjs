#!/usr/bin/env node
// The thing you tested must be the thing the repo declares.
//
// `npm run check` is "the checklist" (AGENTS.md), but it reads whatever happens
// to sit in node_modules, which is untracked state that drifts silently from the
// lockfile. On 2026-08-30 a Dependabot bump took typescript 5.9.3 -> 7.0.2 and
// merged on a red CI. Every local checkout kept passing for four hours, because
// node_modules still held 5.9.3 while package.json said ^7 and the lockfile
// pinned 7.0.2 — and typescript-eslint's peer range (>=4.8.4 <6.1.0) means 7.0.2
// takes eslint down on load. Two agents independently reported green. Both were
// measuring a tree the repo no longer described.
//
// Two failure modes, deliberately at DIFFERENT severities:
//
//   1. installed-vs-lockfile — HARD FAIL. node_modules is meant to be a faithful
//      image of the lockfile; divergence is always a defect.
//   2. tracked files vs HEAD — ADVISORY. A hard assertion here would be vacuous
//      in CI, where the checkout IS HEAD by construction, and obstructive
//      locally, where it fires for anyone mid-task. It would have printed above
//      both of that day's false greens without punishing normal work.
//
// `--strict` promotes the advisory to a failure, for release verification where
// "this run certifies HEAD" has to be literally true.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Direct dependencies whose installed version disagrees with the lockfile.
 *
 * Direct only: a transitive tree can legitimately hold several copies of a
 * package at different versions, so comparing those would report drift that is
 * not drift. The range in package.json is deliberately NOT compared — `^5.9.3`
 * against a resolved `5.9.5` is correct resolution, not divergence. The lockfile
 * is the declaration; node_modules is the claim being audited.
 */
export function findDependencyDrift(dir) {
  const pkgPath = join(dir, "package.json");
  const lockPath = join(dir, "package-lock.json");
  if (!existsSync(pkgPath) || !existsSync(lockPath)) return [];

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const direct = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const hits = [];
  for (const name of Object.keys(direct).sort()) {
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    // No lockfile entry means npm never resolved it here — that is a lockfile
    // problem, not a drift problem, and `npm ci` reports it far better.
    if (!locked) continue;

    const installedPath = join(dir, "node_modules", name, "package.json");
    if (!existsSync(installedPath)) {
      hits.push({ name, locked, installed: null });
      continue;
    }
    const installed = JSON.parse(readFileSync(installedPath, "utf8")).version;
    if (installed !== locked) hits.push({ name, locked, installed });
  }
  return hits;
}

/**
 * Tracked paths differing from HEAD, parsed from `git status --porcelain`.
 *
 * A string parser rather than a git caller, so the rules are unit-testable
 * against fixtures instead of against a scratch repository.
 *
 * Untracked entries (`??`) are excluded on purpose: a file git does not know
 * about cannot make a run disagree with HEAD's *tracked* content, and every
 * working tree accumulates scratch files. Staged and unstaged changes both
 * count — either one means the run covered something HEAD does not contain.
 */
export function parseTrackedDrift(porcelain) {
  const paths = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    if (status === "??" || status === "!!") continue;
    // Renames read "R  old -> new"; the destination is the interesting path.
    const raw = line.slice(3);
    const arrow = raw.indexOf(" -> ");
    paths.push(arrow === -1 ? raw : raw.slice(arrow + 4));
  }
  return paths;
}

function trackedDriftFromGit(dir) {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseTrackedDrift(out);
  } catch {
    // Not a git checkout, or git unavailable. The advisory is a courtesy, not a
    // dependency — never fail the build because we could not look.
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const strict = process.argv.includes("--strict");
  const drift = findDependencyDrift(process.cwd());
  const tracked = trackedDriftFromGit(process.cwd());

  if (tracked.length > 0) {
    console.log(
      `check-tree-matches-declared: ADVISORY — ${tracked.length} tracked file(s) differ from HEAD; this run does not certify HEAD.`,
    );
    for (const path of tracked.slice(0, 15)) console.log(`  ~ ${path}`);
    if (tracked.length > 15) console.log(`  … and ${tracked.length - 15} more`);
  }

  if (drift.length > 0) {
    console.error("check-tree-matches-declared: node_modules does not match the lockfile.");
    for (const hit of drift) {
      console.error(
        hit.installed === null
          ? `  ${hit.name} — lockfile ${hit.locked}, NOT INSTALLED`
          : `  ${hit.name} — lockfile ${hit.locked}, installed ${hit.installed}`,
      );
    }
    console.error("\nEverything this run measured came from node_modules, so its result");
    console.error("describes a tree the repo does not declare. Run `npm ci`, or");
    console.error("`npm install <pkg>@<locked>` for a single package, then re-run.");
    process.exit(1);
  }

  if (strict && tracked.length > 0) {
    console.error("\ncheck-tree-matches-declared: --strict, and the working tree is not HEAD.");
    process.exit(1);
  }

  console.log(
    tracked.length > 0
      ? "check-tree-matches-declared: node_modules matches the lockfile (see advisory above)"
      : "check-tree-matches-declared: node_modules matches the lockfile, working tree is HEAD",
  );
}
