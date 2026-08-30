#!/usr/bin/env node
// Drift check: does the QStash account match what this repo declares?
//
// Exists because QStash stores an absolute destination captured at registration
// time. Nothing resolves it at fire time, so the account silently diverges from
// the code whenever a schedule is added or a hostname moves -- and the only
// symptom is a job that stops running. This turns that into a loud failure.
//
//   npx dotenv -e .env.local -- npm run qstash:check

import { Client } from "@upstash/qstash";
import { expected, resolveBaseUrl, timeoutMilliseconds } from "./qstash-schedules.config.mjs";

if (!process.env.QSTASH_TOKEN?.trim()) {
  console.error("Missing QSTASH_TOKEN.");
  console.error("Run: npx dotenv -e .env.local -- npm run qstash:check");
  process.exit(2);
}
if (!resolveBaseUrl()) {
  console.error("Missing CRON_BASE_URL (preferred) or APP_URL.");
  process.exit(2);
}

const client = new Client({
  token: process.env.QSTASH_TOKEN,
  baseUrl: process.env.QSTASH_URL || undefined,
});

const live = await client.schedules.list();
const byId = new Map(live.map((s) => [s.scheduleId ?? s.id, s]));
const want = expected();
const problems = [];

console.log(`base URL: ${resolveBaseUrl()}`);
console.log(`${live.length} schedule(s) in the QStash account, ${want.length} declared in code\n`);

for (const w of want) {
  const got = byId.get(w.scheduleId);
  if (!got) {
    problems.push(`MISSING    ${w.scheduleId} -- declared in code, absent from QStash (this job never runs)`);
    continue;
  }
  byId.delete(w.scheduleId);
  const issues = [];
  if (got.destination !== w.destination) issues.push(`destination is ${got.destination}, expected ${w.destination}`);
  if (got.cron !== w.cron) issues.push(`cron is "${got.cron}", expected "${w.cron}"`);
  // A timeout shorter than the job needs kills it mid-flight and retries it from
  // scratch. Silent, and indistinguishable from the job simply not working.
  if (w.timeout && got.timeout && timeoutMilliseconds(got.timeout) !== timeoutMilliseconds(w.timeout)) {
    issues.push(`timeout is "${got.timeout}", expected "${w.timeout}"`);
  }
  if (got.isPaused) issues.push("schedule is PAUSED");
  if (issues.length) problems.push(`DRIFTED    ${w.scheduleId} -- ${issues.join("; ")}`);
  else console.log(`  ok  ${w.scheduleId}  ${w.cron}  (timeout ${w.timeout})  -> ${w.destination}`);
}

for (const [id, s] of byId) {
  problems.push(`ORPHANED   ${id} -- in QStash, not declared in code (destination ${s.destination})`);
}

// Comparing code to QStash is not enough: both can agree on a host that has
// stopped serving. On 2026-08-18 the schedules and APP_URL both still named a
// host that had begun 301-ing to the new domain, so a code-vs-account diff
// looked clean while every job was silently failing. Probe the real endpoint.
console.log("\nprobing destinations (unauthenticated POST; 401/403 = healthy):");
for (const w of want) {
  let status;
  try {
    const res = await fetch(w.destination, { method: "POST", redirect: "manual" });
    status = res.status;
  } catch {
    problems.push(`UNREACHABLE ${w.scheduleId} -- ${w.destination} did not respond`);
    continue;
  }
  if (status === 401 || status === 403) {
    console.log(`  ok  ${w.scheduleId}  HTTP ${status} (guarded, route live)`);
  } else if (status >= 300 && status < 400) {
    problems.push(`REDIRECTED ${w.scheduleId} -- ${w.destination} returned ${status}; QStash does not follow redirects on POST, so this job is NOT running`);
  } else if (status === 404 || status === 405) {
    problems.push(`WRONG HOST ${w.scheduleId} -- ${w.destination} returned ${status}; that host does not serve this route`);
  } else {
    console.log(`  ?   ${w.scheduleId}  HTTP ${status} (unexpected, check manually)`);
  }
}

if (!problems.length) {
  console.log("\nIn sync.");
  process.exit(0);
}
console.error("\n" + problems.map((p) => "  " + p).join("\n"));
console.error("\nFix with: npx dotenv -e .env.local -- npm run qstash:schedules");
process.exit(1);
