#!/usr/bin/env node

import { Client } from "@upstash/qstash";
import { expected, resolveBaseUrl } from "./qstash-schedules.config.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Create or update MoneyTalks QStash schedules.

Required env:
  QSTASH_TOKEN
  CRON_BASE_URL (preferred) or APP_URL

Optional env:
  QSTASH_URL
  QSTASH_DIGEST_CRON   default: */15 * * * *
  QSTASH_NOTIFY_CRON   default: 0 * * * *
  QSTASH_PURCHASE_MERGE_CRON default: 30 3 * * *
  QSTASH_RECURRING_SWEEP_CRON default: 45 3 * * *
  QSTASH_GMAIL_BACKFILL_CRON default: */5 * * * *
  QSTASH_FX_CRON       default: 0 11 * * *
  QSTASH_PRICES_CRON   default: 0 2 * * *

Run:
  npx dotenv -e .env.local -- npm run qstash:schedules`);
  process.exit(0);
}

const missing = ["QSTASH_TOKEN"].filter((name) => !process.env[name]?.trim());
if (!resolveBaseUrl()) missing.push("CRON_BASE_URL or APP_URL");

if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  console.error("Example: npx dotenv -e .env.local -- npm run qstash:schedules");
  process.exit(1);
}

const client = new Client({
  token: process.env.QSTASH_TOKEN,
  baseUrl: process.env.QSTASH_URL || undefined,
});

if (!process.env.CRON_BASE_URL?.trim()) {
  console.warn("! CRON_BASE_URL unset, falling back to APP_URL. APP_URL follows the");
  console.warn("  consumer brand and will move again on the next rebrand; set");
  console.warn("  CRON_BASE_URL to a hostname you will never rename.\n");
}

for (const schedule of expected()) {
  const destination = schedule.destination;
  const { scheduleId } = await client.schedules.create({
    destination,
    scheduleId: schedule.scheduleId,
    cron: schedule.cron,
    method: "POST",
    retries: 3,
    timeout: schedule.timeout,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "qstash", job: schedule.name }),
    label: ["moneytalks", schedule.name],
  });

  console.log(`${schedule.name}: ${schedule.cron} (timeout ${schedule.timeout}) -> ${destination} (${scheduleId})`);
}
