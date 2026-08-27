#!/usr/bin/env node
// Read-only. Reports holdings whose stored price currency disagrees with the
// currency MarketLens reports for the same symbol, and the effect on stored
// history.
//
// Why this exists: the retired Alpha Vantage path did not report a currency, and
// TSX securities were stored as USD. Nothing is obviously broken — the price
// magnitude is right — but valuation then FX-converts a CAD figure as though it
// were USD, silently inflating the account. `Holding` rows repair themselves on
// the next successful refresh (planPriceSync overwrites priceCurrency from the
// quote); InvestmentPositionSnapshot rows do not.
//
// This script CHANGES NOTHING. Repairing history is a deliberate migration with
// its own review — rewriting somebody's recorded financial past is not a cleanup.
//
//   node scripts/report-price-currency-drift.mjs

import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

const env = dotenv.parse(fs.readFileSync(".env.local"));
const baseUrl = env.MARKETLENS_BASE_URL?.replace(/\/+$/, "");
const apiKey = env.MARKETLENS_API_KEY;

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();

const holdings = (
  await client.query(`
    SELECT h.id, h.symbol, h.quantity, h."lastPriceMinor", h."priceCurrency", h."priceSource",
           a.currency AS account_currency
    FROM "Holding" h JOIN "FinancialAccount" a ON a.id = h."accountId"
    ORDER BY h.symbol`)
).rows;

if (holdings.length === 0) {
  console.log("No holdings.");
  await client.end();
  process.exit(0);
}

const symbols = [...new Set(holdings.map((h) => h.symbol.toUpperCase()))];
const res = await fetch(
  `${baseUrl}/api/v1/quotes?symbols=${encodeURIComponent(symbols.join(","))}&assetClass=EQUITY`,
  { headers: { "X-API-Key": apiKey } },
);
if (!res.ok) {
  console.error(`MarketLens returned ${res.status}; cannot compare currencies.`);
  await client.end();
  process.exit(1);
}
const batch = await res.json();
const truth = new Map(batch.quotes.map((q) => [q.symbol.toUpperCase(), q]));

const drifted = [];
for (const h of holdings) {
  const quote = truth.get(h.symbol.toUpperCase());
  if (!quote?.currency || !h.priceCurrency) continue;
  if (quote.currency.toUpperCase() !== h.priceCurrency.toUpperCase()) {
    drifted.push({ ...h, actual: quote.currency.toUpperCase() });
  }
}

console.log(`expectedSession ${batch.expectedSession}\n`);
if (drifted.length === 0) {
  console.log("No price-currency drift. Every stored currency matches MarketLens.");
} else {
  console.log("HOLDINGS WITH THE WRONG STORED PRICE CURRENCY");
  console.log("(these self-heal on the next successful refresh)\n");
  for (const d of drifted) {
    console.log(
      `  ${d.symbol.padEnd(10)} stored ${d.priceCurrency} -> actually ${d.actual}` +
        `   qty ${Number(d.quantity)} @ ${(d.lastPriceMinor / 100).toFixed(2)}` +
        `   account ${d.account_currency}   src ${d.priceSource}`,
    );
  }

  const ids = drifted.map((d) => d.id);
  const affected = (
    await client.query(
      `SELECT count(DISTINCT p."accountSnapshotId")::int AS snapshots,
              count(*)::int AS positions,
              to_char(min(s."asOf"), 'YYYY-MM-DD') AS earliest,
              to_char(max(s."asOf"), 'YYYY-MM-DD') AS latest
       FROM "InvestmentPositionSnapshot" p
       JOIN "InvestmentAccountSnapshot" s ON s.id = p."accountSnapshotId"
       WHERE p."holdingId" = ANY($1::text[]) AND upper(p."priceCurrency") <> ALL($2::text[])`,
      [ids, [...new Set(drifted.map((d) => d.actual))]],
    )
  ).rows[0];

  console.log("\nSTORED HISTORY AFFECTED (does NOT self-heal)");
  console.log(
    `  ${affected.positions} position snapshot(s) across ${affected.snapshots} account snapshot(s)` +
      `, ${affected.earliest} .. ${affected.latest}`,
  );
  console.log(
    "\n  Repairing these means recomputing marketValueMinor, displayMarketValueMinor",
  );
  console.log("  and the parent account totals. Deliberate migration, not a cleanup.");
}

await client.end();
