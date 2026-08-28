import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
