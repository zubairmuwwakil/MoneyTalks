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
    const root = tree({
      "a.ts": "const providerKey = await readProviderKeys();\nconsole.log(providerKey);",
    });
    expect(findKeyLeaks(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a provider key placed in a query string", () => {
    const root = tree({ "a.ts": "redirect(`/done?providerKey=${providerKey}`);" });
    expect(findKeyLeaks(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a provider key handed to a structured logger", () => {
    const root = tree({ "a.ts": "logger.warn({ providerKey });" });
    expect(findKeyLeaks(root)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows the key riding one outbound header, which is its whole purpose", () => {
    const root = tree({
      "a.ts": 'headers.set("X-Provider-Key", `${provider}=${providerKey}`);',
    });
    expect(findKeyLeaks(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows logging which providers were configured, not their values", () => {
    // The count and the names are diagnostics; the secret is the value.
    const root = tree({ "a.ts": "console.log(Object.keys(providerKeys).length);" });
    expect(findKeyLeaks(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("reports the file and line so the hit can be found", () => {
    const root = tree({ "nested/b.ts": "// header\nconsole.error(providerSecret);" });
    expect(findKeyLeaks(root)).toEqual([
      { file: "nested/b.ts", line: 2, text: "console.error(providerSecret);" },
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});
