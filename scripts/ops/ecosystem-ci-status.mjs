/**
 * Ecosystem CI Status Evaluator
 *
 * Pure evaluation functions and repository target declarations for the
 * 6-repo In Unity ecosystem alarm.
 *
 * Evaluates:
 * 1. Red builds on default branches (excluding advisory jobs like contracts-freshness).
 * 2. Silent blackouts / stale CI where no verification run has occurred within the threshold.
 * 3. Repositories with zero runs on their declared default branch.
 */

export const DEFAULT_STALE_HOURS = 48;
export const DEFAULT_RED_HOURS = 24;

export const ECOSYSTEM_REPOS = [
  {
    owner: "zubairmuwwakil",
    repo: "MoneyTalks",
    defaultBranch: "main",
    workflowFile: "ci.yml",
    workflowName: "CI",
    advisoryJobs: ["contracts-freshness"],
  },
  {
    owner: "zubairmuwwakil",
    repo: "marketdata",
    defaultBranch: "main",
    workflowFile: "ci.yml",
    workflowName: "CI",
  },
  {
    owner: "zubairmuwwakil",
    repo: "PickMe",
    defaultBranch: "main",
    workflowFile: "ci.yml",
    workflowName: "CI",
  },
  {
    owner: "zubairmuwwakil",
    repo: "return-saas",
    defaultBranch: "organized",
    workflowFile: "ci.yml",
    workflowName: "CI",
  },
  {
    owner: "zubairmuwwakil",
    repo: "agent-orchestrator",
    defaultBranch: "main",
    workflowFile: "ci.yml",
    workflowName: "CI",
  },
  {
    owner: "zubairmuwwakil",
    repo: "pickleball-session-manager",
    defaultBranch: "main",
    workflowFile: "quality.yml",
    workflowName: "Quality Gates",
  },
];

/**
 * Normalizes workflow path/filename for comparison.
 */
export function isTargetWorkflow(workflowPathOrName, target) {
  if (!workflowPathOrName) return false;
  if (workflowPathOrName === target.workflowFile) return true;
  if (workflowPathOrName.endsWith(`/${target.workflowFile}`)) return true;
  if (target.workflowName && workflowPathOrName === target.workflowName) return true;
  return false;
}

/**
 * Evaluates the CI health of a repository given its runs and jobs.
 *
 * @param {Object} params
 * @param {Object} params.target - Repo configuration
 * @param {Array<Object>} params.runs - Workflow runs list for this repo
 * @param {Array<Object>} [params.jobs] - Jobs list for the latest run
 * @param {Date|string|number} [params.now] - Evaluation timestamp
 * @param {Object} [params.options] - Configuration options
 * @param {number} [params.options.staleThresholdHours] - Stale threshold (default: 48h)
 * @param {number} [params.options.redThresholdHours] - Red age threshold (default: 24h)
 * @param {boolean} [params.options.alarmOnAnyFailure] - Whether any red build alarms immediately
 * @param {string} [params.authError] - Error message if private repo was unreadable
 */
export function evaluateRepoCiStatus({
  target,
  runs = [],
  jobs = [],
  now = new Date(),
  options = {},
  authError = null,
}) {
  const staleThresholdHours = options.staleThresholdHours ?? DEFAULT_STALE_HOURS;
  const redThresholdHours = options.redThresholdHours ?? DEFAULT_RED_HOURS;
  const alarmOnAnyFailure = options.alarmOnAnyFailure ?? true;
  const nowMs = new Date(now).getTime();

  const fullName = `${target.owner}/${target.repo}`;

  if (authError) {
    return {
      repo: target.repo,
      fullName,
      defaultBranch: target.defaultBranch,
      workflowFile: target.workflowFile,
      verdict: "AUTH_REQUIRED",
      isAlarm: true,
      latestRunId: null,
      latestRunCreatedAt: null,
      ageHours: null,
      conclusion: null,
      details: `Authentication required: ${authError}`,
    };
  }

  // Filter completed runs matching target workflow and default branch
  const matchingRuns = runs.filter((run) => {
    if (!run) return false;
    const branchMatch = run.head_branch === target.defaultBranch;
    const completedMatch = run.status === "completed";
    const workflowMatch = run.path ? isTargetWorkflow(run.path, target) : (run.name === target.workflowName || isTargetWorkflow(target.workflowFile, target));
    return branchMatch && completedMatch && workflowMatch;
  });

  // Sort newest first
  matchingRuns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const latestRun = matchingRuns[0];

  if (!latestRun) {
    return {
      repo: target.repo,
      fullName,
      defaultBranch: target.defaultBranch,
      workflowFile: target.workflowFile,
      verdict: "NO_RUNS",
      isAlarm: true,
      latestRunId: null,
      latestRunCreatedAt: null,
      ageHours: null,
      conclusion: null,
      details: `No completed runs of ${target.workflowFile} on ${target.defaultBranch}`,
    };
  }

  const runMs = new Date(latestRun.created_at).getTime();
  const ageHours = Number(((nowMs - runMs) / (1000 * 60 * 60)).toFixed(1));

  // If the run failed, inspect if the failure was purely advisory (e.g. contracts-freshness)
  let effectiveConclusion = latestRun.conclusion;
  let advisoryFailureNote = null;

  if (latestRun.conclusion !== "success" && target.advisoryJobs?.length && jobs.length > 0) {
    const failedJobs = jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
    const failedCoreJobs = failedJobs.filter((j) => !target.advisoryJobs.includes(j.name));
    if (failedJobs.length > 0 && failedCoreJobs.length === 0) {
      // Only advisory jobs failed
      effectiveConclusion = "success";
      advisoryFailureNote = `Advisory job(s) failed (${failedJobs.map((j) => j.name).join(", ")}), core jobs green`;
    }
  }

  if (effectiveConclusion === "success") {
    if (ageHours > staleThresholdHours) {
      return {
        repo: target.repo,
        fullName,
        defaultBranch: target.defaultBranch,
        workflowFile: target.workflowFile,
        verdict: "STALE_CI",
        isAlarm: true,
        latestRunId: latestRun.id,
        latestRunCreatedAt: latestRun.created_at,
        ageHours,
        conclusion: "success",
        details: advisoryFailureNote
          ? `CI run green (${advisoryFailureNote}) but stale (${ageHours}h > ${staleThresholdHours}h)`
          : `CI run green but stale (${ageHours}h > ${staleThresholdHours}h)`,
      };
    }

    return {
      repo: target.repo,
      fullName,
      defaultBranch: target.defaultBranch,
      workflowFile: target.workflowFile,
      verdict: "HEALTHY",
      isAlarm: false,
      latestRunId: latestRun.id,
      latestRunCreatedAt: latestRun.created_at,
      ageHours,
      conclusion: "success",
      details: advisoryFailureNote
        ? `Green (${advisoryFailureNote}, ${ageHours}h ago)`
        : `Green and fresh (${ageHours}h ago)`,
    };
  }

  // Failed run on default branch
  const isStaleRed = ageHours > redThresholdHours;
  const isAlarm = alarmOnAnyFailure || isStaleRed;
  const verdict = isStaleRed ? "RED_STALE" : "RED";

  return {
    repo: target.repo,
    fullName,
    defaultBranch: target.defaultBranch,
    workflowFile: target.workflowFile,
    verdict,
    isAlarm,
    latestRunId: latestRun.id,
    latestRunCreatedAt: latestRun.created_at,
    ageHours,
    conclusion: latestRun.conclusion,
    details: isStaleRed
      ? `CI failure on ${target.defaultBranch} unaddressed for ${ageHours}h (> ${redThresholdHours}h)`
      : `CI failure on ${target.defaultBranch} (${ageHours}h ago)`,
  };
}

/**
 * Formats evaluation results as a markdown table.
 */
export function formatMarkdownTable(results) {
  const headers = ["Repo", "Branch", "Workflow", "Run ID", "Conclusion", "Age (h)", "Verdict", "Status"];
  const divider = ["---", "---", "---", "---", "---", "---", "---", "---"];

  const rows = results.map((r) => {
    const statusIcon = r.isAlarm ? "🔴 ALARM" : "🟢 OK";
    const runIdStr = r.latestRunId ? String(r.latestRunId) : "—";
    const conclusionStr = r.conclusion ? r.conclusion : "—";
    const ageStr = r.ageHours !== null ? `${r.ageHours}h` : "—";

    return [
      r.repo,
      r.defaultBranch,
      r.workflowFile,
      runIdStr,
      conclusionStr,
      ageStr,
      r.verdict,
      statusIcon,
    ];
  });

  const allLines = [
    `| ${headers.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];

  return allLines.join("\n");
}

/**
 * Formats evaluation results into one-line verdicts.
 */
export function formatVerdicts(results) {
  return results.map((r) => {
    const icon = r.isAlarm ? "❌" : "✅";
    return `${icon} ${r.repo} (${r.defaultBranch}): [${r.verdict}] ${r.details}`;
  });
}
