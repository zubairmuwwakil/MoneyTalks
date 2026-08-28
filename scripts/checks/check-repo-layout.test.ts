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

  it("flags an unrecognised bucket invented under scripts/", () => {
    const root = repo(["scripts/checks/a.mjs", "scripts/misc/b.mjs"]);
    expect(findStrayFiles(root)).toEqual(["scripts/misc"]);
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

  it("leaves loose files directly under docs/ alone", () => {
    // ROADMAP.md and ECOSYSTEM-NARRATIVE.md live there by design. The rule is
    // about inventing new *folders*, which is how two plan directories happened.
    const root = repo(["docs/ROADMAP.md", "docs/decisions/a.md"]);
    expect(findStrayFiles(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("says nothing about a repo with neither directory", () => {
    const root = repo(["README.md"]);
    expect(findStrayFiles(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
