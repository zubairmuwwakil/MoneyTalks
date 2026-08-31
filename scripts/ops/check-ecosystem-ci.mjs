#!/usr/bin/env node
/**
 * Ecosystem CI Freshness & Red Alarm Runner
 *
 * Checks all 6 ecosystem repositories for:
 * 1. Red verification CI on default branches (excluding advisory jobs).
 * 2. Silent blackouts / stale CI (> 48h without a verification run).
 * 3. Repositories with zero CI runs on their declared default branch.
 *
 * Outputs a formatted report table and exits non-zero if any repo triggers an alarm.
 */

import { appendFileSync } from "node:fs";
import {
  ECOSYSTEM_REPOS,
  evaluateRepoCiStatus,
  formatMarkdownTable,
  formatVerdicts,
  DEFAULT_STALE_HOURS,
  DEFAULT_RED_HOURS,
} from "./ecosystem-ci-status.mjs";

const token =
  process.env.ECOSYSTEM_CI_TOKEN?.trim() ||
  process.env.GH_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim();

const staleThresholdHours = process.env.CI_STALE_HOURS
  ? Number(process.env.CI_STALE_HOURS)
  : DEFAULT_STALE_HOURS;

const redThresholdHours = process.env.CI_RED_HOURS
  ? Number(process.env.CI_RED_HOURS)
  : DEFAULT_RED_HOURS;

async function fetchGithub(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "InUnity-Ecosystem-CI-Alarm",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  return res;
}

async function checkRepo(target, now) {
  const url = `https://api.github.com/repos/${target.owner}/${target.repo}/actions/workflows/${target.workflowFile}/runs?branch=${encodeURIComponent(target.defaultBranch)}&status=completed&per_page=5`;

  try {
    const res = await fetchGithub(url);

    if (res.status === 404) {
      return evaluateRepoCiStatus({
        target,
        runs: [],
        now,
        authError: "Repository or workflow not found / private repo inaccessible without token (HTTP 404)",
      });
    }

    if (res.status === 401 || res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const err = remaining === "0"
        ? "GitHub API rate limit exceeded (HTTP 403)"
        : `GitHub API error (HTTP ${res.status})`;
      return evaluateRepoCiStatus({
        target,
        runs: [],
        now,
        authError: err,
      });
    }

    if (!res.ok) {
      return evaluateRepoCiStatus({
        target,
        runs: [],
        now,
        authError: `GitHub API returned HTTP ${res.status}`,
      });
    }

    const data = await res.json();
    const runs = data.workflow_runs || [];

    // If the latest run failed and the repo has advisory jobs defined, inspect individual job statuses
    let jobs = [];
    const latestRun = runs[0];
    if (latestRun && latestRun.conclusion !== "success" && target.advisoryJobs?.length > 0) {
      try {
        const jobsUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/actions/runs/${latestRun.id}/jobs?per_page=50`;
        const jobsRes = await fetchGithub(jobsUrl);
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          jobs = jobsData.jobs || [];
        }
      } catch {
        // Fall back to overall workflow conclusion if jobs query fails
      }
    }

    return evaluateRepoCiStatus({
      target,
      runs,
      jobs,
      now,
      options: {
        staleThresholdHours,
        redThresholdHours,
      },
    });
  } catch (err) {
    return evaluateRepoCiStatus({
      target,
      runs: [],
      now,
      authError: `Network error connecting to GitHub: ${err.message}`,
    });
  }
}

async function main() {
  const now = new Date();
  console.log(`=======================================================`);
  console.log(`  Ecosystem CI Alarm Audit — ${now.toISOString()}`);
  console.log(`  Stale Threshold: >${staleThresholdHours}h | Red Threshold: >${redThresholdHours}h`);
  console.log(`  Auth: ${token ? "Token configured" : "Unauthenticated (public repos only)"}`);
  console.log(`=======================================================\n`);

  const results = [];
  for (const target of ECOSYSTEM_REPOS) {
    const result = await checkRepo(target, now);
    results.push(result);
  }

  const table = formatMarkdownTable(results);
  const verdicts = formatVerdicts(results);

  console.log("### CI Status Summary Table\n");
  console.log(table);
  console.log("\n### Verdicts\n");
  for (const v of verdicts) {
    console.log(v);
  }

  // Write to GitHub Step Summary if running in GitHub Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const summaryContent = [
        `# Ecosystem CI Alarm Report`,
        `**Evaluation Time:** \`${now.toISOString()}\``,
        `**Thresholds:** Stale: \`>${staleThresholdHours}h\` | Red: \`>${redThresholdHours}h\``,
        "",
        table,
        "",
        "### Verdicts",
        ...verdicts.map((v) => `- ${v}`),
        "",
      ].join("\n");
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryContent);
    } catch {
      // Step summary write is best-effort
    }
  }

  const alarms = results.filter((r) => r.isAlarm);
  console.log(`\n=======================================================`);
  if (alarms.length > 0) {
    console.error(`🚨 ALARM: ${alarms.length} repo(s) require attention:`);
    for (const a of alarms) {
      console.error(`   - ${a.repo} (${a.defaultBranch}): [${a.verdict}] ${a.details}`);
    }
    console.error(`=======================================================\n`);
    process.exit(1);
  } else {
    console.log(`✅ All 6 ecosystem repositories are HEALTHY.`);
    console.log(`=======================================================\n`);
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Unexpected error in check-ecosystem-ci:", err);
    process.exit(2);
  });
}
