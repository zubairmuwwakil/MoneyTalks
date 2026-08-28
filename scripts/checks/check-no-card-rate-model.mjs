#!/usr/bin/env node
// The catalogue says what the CARD is; CreditCard says what the USER'S COPY is.
// A rate, cap, multiplier or credit on a per-user row is the drift this exists to
// stop. Card facts resolve from contracts/card-catalogue.json via catalogueCard.ts.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadExceptionsFor } from "./check-policy-exception-expiry.mjs";

// Deliberately does NOT match annualFeeMinor or feeRebateMinor: those describe
// the owner's account, not the card's published rate model.
const RATE_SHAPED =
  /^(rewards?|earn[A-Z]\w*|reward[A-Z]\w*|cashback\w*|points?Per\w*|\w*[Mm]ultiplier|\w*[Cc]ap(Minor|Cents|Amount)?|categoryRate\w*|bonusRate\w*)$/;

export function findRateFields(schemaText) {
  const model = schemaText.match(/model\s+CreditCard\s*\{([\s\S]*?)\n\}/);
  if (!model) return [];

  const hits = [];
  for (const line of model[1].split("\n")) {
    const bare = line.trim();
    if (bare.startsWith("//") || bare.startsWith("@@") || bare.length === 0) continue;
    const name = bare.split(/\s+/)[0];
    if (RATE_SHAPED.test(name)) hits.push(name);
  }
  return hits;
}

export function findRateModules(dir) {
  if (!existsSync(dir)) return [];
  const exempt = new Set(loadExceptionsFor("no-card-rate-model").map((exception) => exception.path));
  const hits = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || exempt.has(full)) continue;
    const text = readFileSync(full, "utf8");
    if (/\b(CardRewards|CARD_PRESETS|cardPresets)\b/.test(text)) hits.push(full);
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fields = findRateFields(readFileSync("prisma/schema.prisma", "utf8"));
  const modules = findRateModules("src/lib/cards");
  if (fields.length > 0 || modules.length > 0) {
    console.error("check-no-card-rate-model: a card rate model is reappearing in this repo.");
    for (const field of fields) console.error(`  CreditCard.${field} — a rate on a per-user row`);
    for (const file of modules) console.error(`  ${file} — a hand-authored rate table`);
    console.error("\nCard rates belong to PickMe (C1). Facts resolve from");
    console.error("contracts/card-catalogue.json through src/lib/cards/catalogueCard.ts.");
    console.error("A card that is not in the catalogue goes through /cards/request (D3).");
    process.exit(1);
  }
  console.log("check-no-card-rate-model: no rate model in this repo");
}
