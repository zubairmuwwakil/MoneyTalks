import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findDependencyDrift, parseTrackedDrift } from "./check-tree-matches-declared.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A fixture tree. `declared` is the package.json range, `locked` what the
 * lockfile resolved, `installed` what actually sits in node_modules — the three
 * values whose disagreement is the whole subject of this check. `installed:
 * null` means the package is absent.
 */
function repo(
  packages: Record<string, { declared: string; locked?: string; installed?: string | null; dev?: boolean }>,
  extraLockEntries: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "declared-"));
  roots.push(root);

  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  const lockPackages: Record<string, { version: string }> = {};

  for (const [name, spec] of Object.entries(packages)) {
    (spec.dev ? devDependencies : dependencies)[name] = spec.declared;
    if (spec.locked) lockPackages[`node_modules/${name}`] = { version: spec.locked };
    if (spec.installed) {
      const dir = join(root, "node_modules", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: spec.installed }));
    }
  }
  for (const [path, version] of Object.entries(extraLockEntries)) {
    lockPackages[path] = { version };
  }

  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies, devDependencies }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ packages: { "": { dependencies, devDependencies }, ...lockPackages } }),
  );
  return root;
}

describe("findDependencyDrift", () => {
  it("passes when every direct dependency matches the lockfile", () => {
    const root = repo({
      typescript: { declared: "~5.9.3", locked: "5.9.3", installed: "5.9.3", dev: true },
      next: { declared: "^15.0.0", locked: "15.2.1", installed: "15.2.1" },
    });
    expect(findDependencyDrift(root)).toEqual([]);
  });

  it("catches the typescript 7.0.2 case: lockfile bumped, node_modules stale", () => {
    const root = repo({
      typescript: { declared: "^7", locked: "7.0.2", installed: "5.9.3", dev: true },
    });
    expect(findDependencyDrift(root)).toEqual([
      { name: "typescript", locked: "7.0.2", installed: "5.9.3" },
    ]);
  });

  it("reports a direct dependency the lockfile names but nothing installed", () => {
    const root = repo({ next: { declared: "^15.0.0", locked: "15.2.1", installed: null } });
    expect(findDependencyDrift(root)).toEqual([
      { name: "next", locked: "15.2.1", installed: null },
    ]);
  });

  // NEAR MISS. A caret range resolving above its floor is correct npm behaviour.
  // Comparing the range instead of the lockfile would fire on every healthy repo
  // and train everyone to ignore this check.
  it("does NOT fire when the range differs from the resolved version", () => {
    const root = repo({
      typescript: { declared: "^5.9.3", locked: "5.9.5", installed: "5.9.5", dev: true },
    });
    expect(findDependencyDrift(root)).toEqual([]);
  });

  // NEAR MISS. A transitive tree may legitimately hold several copies of one
  // package at different versions; only direct dependencies are auditable this way.
  it("does NOT fire on a nested transitive copy at another version", () => {
    const root = repo(
      { next: { declared: "^15.0.0", locked: "15.2.1", installed: "15.2.1" } },
      { "node_modules/next/node_modules/semver": "6.3.1", "node_modules/semver": "7.6.0" },
    );
    expect(findDependencyDrift(root)).toEqual([]);
  });

  // NEAR MISS. An unresolvable lockfile is `npm ci`'s problem and it says so far
  // better; this check must not turn it into a confusing drift report.
  it("does NOT fire when the lockfile has no entry for a declared dependency", () => {
    const root = repo({ ghost: { declared: "^1.0.0", installed: null } });
    expect(findDependencyDrift(root)).toEqual([]);
  });

  it("returns nothing when there is no package.json to audit", () => {
    const root = mkdtempSync(join(tmpdir(), "declared-empty-"));
    roots.push(root);
    expect(findDependencyDrift(root)).toEqual([]);
  });
});

describe("parseTrackedDrift", () => {
  it("reports staged and unstaged tracked changes alike", () => {
    expect(parseTrackedDrift(" M src/a.ts\nM  src/b.ts\nA  src/c.ts\n")).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  // NEAR MISS. Untracked files cannot make a run disagree with HEAD's tracked
  // content, and every working tree accumulates them — flagging them would make
  // the advisory permanent noise.
  it("does NOT report untracked or ignored files", () => {
    expect(parseTrackedDrift("?? scratch.ts\n!! node_modules/\n M src/a.ts\n")).toEqual(["src/a.ts"]);
  });

  it("reports the destination of a rename", () => {
    expect(parseTrackedDrift("R  src/old.ts -> src/new.ts\n")).toEqual(["src/new.ts"]);
  });

  it("is empty for a clean tree", () => {
    expect(parseTrackedDrift("")).toEqual([]);
    expect(parseTrackedDrift("\n")).toEqual([]);
  });
});
