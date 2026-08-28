#!/usr/bin/env node
// BYOK keys live here encrypted (src/lib/security/providerKeys.ts, secretCrypto
// envelopes) and are decrypted only long enough to ride one outbound header.
// They are never logged, echoed, or placed in a redirect query string — a URL
// lands in browser history, server logs, and any referrer, so a key that reaches
// one has escaped to three places at once and cannot be called back.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const KEY = "(providerKey|providerKeys|decryptedKey|providerSecret)";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

const LEAKS = [
  // console.log(providerKey) — but not console.log(Object.keys(providerKeys).length),
  // where the name is reached through an accessor rather than passed as the value.
  new RegExp(`console\\.(log|info|warn|error|debug|trace)\\([^)]*\\b${KEY}\\b(?!\\s*\\)?\\.)`),
  // A key interpolated into a query string.
  new RegExp(`[?&][A-Za-z]*[Kk]ey=\\$\\{[^}]*${KEY}`),
  // Structured loggers: logger.warn({ providerKey }), log.error(providerKey).
  new RegExp(`\\b(logger|log)\\.[a-z]+\\([^)]*\\b${KEY}\\b(?!\\s*\\)?\\.)`),
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

export function findKeyLeaks(dir) {
  const hits = [];
  for (const file of walk(dir)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, i) => {
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
    for (const hit of hits) console.error(`  src/${hit.file}:${hit.line}  ${hit.text}`);
    console.error("\nA decrypted key rides one outbound header and nothing else.");
    console.error("Log which providers were configured if you need a diagnostic;");
    console.error("never the value. See docs/policies/marketlens.md.");
    process.exit(1);
  }
  console.log("check-no-key-leakage: no provider key leaks");
}
