#!/usr/bin/env node
// MarketLens owns market data (E3/E4). This hub consumes it over HTTP via
// src/lib/services/marketlens.ts and never speaks to a price provider directly.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
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
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXTENSIONS.has(extname(full))) out.push(full);
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
  const exempt = loadExceptionsFor("no-market-data-provider").map((exception) =>
    exception.path.replace(/^src\//, ""),
  );
  const hits = findProviderHosts("src", exempt);
  if (hits.length > 0) {
    console.error("check-no-market-data-provider: this repo is talking to a price provider.");
    for (const hit of hits) console.error(`  src/${hit.file} -> ${hit.host}`);
    console.error("\nMarketLens owns market data (E3/E4). Consume it through");
    console.error("src/lib/services/marketlens.ts. If this is genuinely temporary,");
    console.error("add a dated entry to docs/policies/exceptions.json.");
    process.exit(1);
  }
  console.log("check-no-market-data-provider: no direct provider access");
}
