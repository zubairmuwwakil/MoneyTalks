import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    const root = tree({ "a.tsx": "<p>Real-time prices for your portfolio</p>" });
    expect(findRealtimeClaims(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags the hyphenless spelling", () => {
    const root = tree({ "a.tsx": "<p>realtime quotes</p>" });
    expect(findRealtimeClaims(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows an explicit denial, which is the honest phrasing", () => {
    const root = tree({ "a.tsx": "<p>Daily closes, not real-time prices.</p>" });
    expect(findRealtimeClaims(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows real-time claims unrelated to market data", () => {
    const root = tree({ "a.tsx": "<p>Real-time catalogue scoring</p>" });
    expect(findRealtimeClaims(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("ignores comments, which are not user-facing copy", () => {
    const root = tree({ "a.ts": "// we deliberately do not offer real-time data\nexport const x = 1;" });
    expect(findRealtimeClaims(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
