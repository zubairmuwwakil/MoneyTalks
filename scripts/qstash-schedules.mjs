#!/usr/bin/env node

import { Client } from "@upstash/qstash";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Create or update MoneyTalks QStash schedules.

Required env:
  QSTASH_TOKEN
  APP_URL

Optional env:
  QSTASH_URL
  QSTASH_DIGEST_CRON   default: */15 * * * *
  QSTASH_NOTIFY_CRON   default: 0 * * * *
  QSTASH_PURCHASE_MERGE_CRON default: 30 3 * * *

Run:
  npx dotenv -e .env.local -- npm run qstash:schedules`);
  process.exit(0);
}

const required = ["QSTASH_TOKEN", "APP_URL"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  console.error("Example: npx dotenv -e .env.local -- npm run qstash:schedules");
  process.exit(1);
}

const appUrl = process.env.APP_URL.trim().replace(/\/+$/, "");
const client = new Client({
  token: process.env.QSTASH_TOKEN,
  baseUrl: process.env.QSTASH_URL || undefined,
});

const schedules = [
  {
    name: "digest",
    scheduleId: "moneytalks-digest",
    path: "/api/cron/digest",
    cron: process.env.QSTASH_DIGEST_CRON || "*/15 * * * *",
  },
  {
    name: "notify",
    scheduleId: "moneytalks-notify",
    path: "/api/cron/notify",
    cron: process.env.QSTASH_NOTIFY_CRON || "0 * * * *",
  },
  {
    name: "purchase-merge",
    scheduleId: "moneytalks-purchase-merge",
    path: "/api/cron/purchase-merge",
    cron: process.env.QSTASH_PURCHASE_MERGE_CRON || "30 3 * * *",
  },
];

for (const schedule of schedules) {
  const destination = `${appUrl}${schedule.path}`;
  const { scheduleId } = await client.schedules.create({
    destination,
    scheduleId: schedule.scheduleId,
    cron: schedule.cron,
    method: "POST",
    retries: 3,
    timeout: "2m",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "qstash", job: schedule.name }),
    label: ["moneytalks", schedule.name],
  });

  console.log(`${schedule.name}: ${schedule.cron} -> ${destination} (${scheduleId})`);
}
