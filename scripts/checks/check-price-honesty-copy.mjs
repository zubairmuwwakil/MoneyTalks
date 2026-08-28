#!/usr/bin/env node
// A6, the honesty invariant: MarketLens serves daily closes, so the product must
// never promise real-time market data. This deliberately targets price, quote,
// and valuation claims—not unrelated real-time product behaviour.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const PRICE_CLAIM =
  /(?:real[\s-]?time|live)\s+(?:market\s+)?(?:prices?|quotes?|valuations?)|(?:market\s+)?(?:prices?|quotes?|valuations?)\s+(?:update\s+)?(?:in\s+)?(?:real[\s-]?time|live)/i;
// "not real-time" / "never real-time" / "rather than real-time" are denials, not claims.
const DENIAL = /\b(not|never|no|rather than|instead of)\b[^.]{0,24}real[\s-]?time/i;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

export function findRealtimeClaims(dir) {
  const hits = [];
  for (const file of walk(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      const bare = text.trim();
      if (bare.startsWith("//") || bare.startsWith("*") || bare.startsWith("/*")) return;
      if (PRICE_CLAIM.test(text) && !DENIAL.test(text)) {
        hits.push({ file: relative(dir, file), line: index + 1, text: bare });
      }
    });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findRealtimeClaims("src");
  if (hits.length > 0) {
    console.error("check-price-honesty-copy: copy claims real-time pricing (A6).");
    for (const hit of hits) console.error(`  src/${hit.file}:${hit.line}  ${hit.text}`);
    console.error('\nMarketLens serves daily closes. Say "daily close" or "latest close".');
    process.exit(1);
  }
  console.log("check-price-honesty-copy: no real-time price claims");
}
