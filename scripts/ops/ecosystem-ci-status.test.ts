import { describe, it, expect } from "vitest";
import {
  evaluateRepoCiStatus,
  formatMarkdownTable,
  formatVerdicts,
  isTargetWorkflow,
  ECOSYSTEM_REPOS,
} from "./ecosystem-ci-status.mjs";

describe("ecosystem-ci-status", () => {
  const BASE_DATE = new Date("2026-08-31T12:00:00Z");

  const moneyTalksTarget = ECOSYSTEM_REPOS.find((r) => r.repo === "MoneyTalks")!;
  const marketdataTarget = ECOSYSTEM_REPOS.find((r) => r.repo === "marketdata")!;
  const returnSaasTarget = ECOSYSTEM_REPOS.find((r) => r.repo === "return-saas")!;
  const pickleballTarget = ECOSYSTEM_REPOS.find((r) => r.repo === "pickleball-session-manager")!;

  describe("isTargetWorkflow", () => {
    it("matches exact workflow filename or path", () => {
      expect(isTargetWorkflow("ci.yml", moneyTalksTarget)).toBe(true);
      expect(isTargetWorkflow(".github/workflows/ci.yml", moneyTalksTarget)).toBe(true);
      expect(isTargetWorkflow("CI", moneyTalksTarget)).toBe(true);
      expect(isTargetWorkflow(".github/workflows/document-freshness.yml", moneyTalksTarget)).toBe(false);
      expect(isTargetWorkflow("Document freshness (advisory)", moneyTalksTarget)).toBe(false);
    });

    it("matches quality.yml for pickleball-session-manager", () => {
      expect(isTargetWorkflow(".github/workflows/quality.yml", pickleballTarget)).toBe(true);
      expect(isTargetWorkflow("Quality Gates", pickleballTarget)).toBe(true);
      expect(isTargetWorkflow(".github/workflows/a11y.yml", pickleballTarget)).toBe(false);
    });
  });

  describe("evaluateRepoCiStatus", () => {
    it("evaluates a fresh green run as HEALTHY", () => {
      const runs = [
        {
          id: 101,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-31T06:00:00Z", // 6 hours old
        },
      ];

      const result = evaluateRepoCiStatus({
        target: marketdataTarget,
        runs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("HEALTHY");
      expect(result.isAlarm).toBe(false);
      expect(result.ageHours).toBe(6);
      expect(result.latestRunId).toBe(101);
      expect(result.conclusion).toBe("success");
    });

    it("evaluates an old green run (>48h) as STALE_CI alarm", () => {
      const runs = [
        {
          id: 102,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-29T10:00:00Z", // 50 hours old
        },
      ];

      const result = evaluateRepoCiStatus({
        target: marketdataTarget,
        runs,
        now: BASE_DATE,
        options: { staleThresholdHours: 48 },
      });

      expect(result.verdict).toBe("STALE_CI");
      expect(result.isAlarm).toBe(true);
      expect(result.ageHours).toBe(50);
      expect(result.details).toContain("stale");
    });

    it("evaluates a fresh red run (<24h) as RED alarm", () => {
      const runs = [
        {
          id: 103,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "failure",
          created_at: "2026-08-31T10:00:00Z", // 2 hours old
        },
      ];

      const result = evaluateRepoCiStatus({
        target: marketdataTarget,
        runs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("RED");
      expect(result.isAlarm).toBe(true);
      expect(result.ageHours).toBe(2);
      expect(result.conclusion).toBe("failure");
    });

    it("evaluates an old red run (>24h) as RED_STALE alarm", () => {
      const runs = [
        {
          id: 104,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "failure",
          created_at: "2026-08-30T06:00:00Z", // 30 hours old
        },
      ];

      const result = evaluateRepoCiStatus({
        target: marketdataTarget,
        runs,
        now: BASE_DATE,
        options: { redThresholdHours: 24 },
      });

      expect(result.verdict).toBe("RED_STALE");
      expect(result.isAlarm).toBe(true);
      expect(result.ageHours).toBe(30);
      expect(result.details).toContain("unaddressed");
    });

    it("evaluates a repo with zero completed runs on default branch as NO_RUNS alarm", () => {
      const runs: Array<{
        id: number;
        name: string;
        head_branch: string;
        path: string;
        status: string;
        conclusion: string | null;
        created_at: string;
      }> = [];

      const result = evaluateRepoCiStatus({
        target: returnSaasTarget, // defaultBranch: "organized"
        runs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("NO_RUNS");
      expect(result.isAlarm).toBe(true);
      expect(result.latestRunId).toBeNull();
      expect(result.details).toContain("No completed runs of ci.yml on organized");
    });

    it("ignores advisory workflows (e.g. document freshness) and identifies true CI staleness", () => {
      const runs = [
        {
          id: 201,
          name: "Document freshness (advisory)",
          head_branch: "main",
          path: ".github/workflows/document-freshness.yml",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-31T11:50:00Z", // 10 minutes ago
        },
        {
          id: 202,
          name: "Dependabot Updates",
          head_branch: "main",
          path: "dynamic/dependabot/dependabot-updates",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-31T11:45:00Z",
        },
      ];

      const result = evaluateRepoCiStatus({
        target: marketdataTarget,
        runs,
        now: BASE_DATE,
      });

      // Because only advisory runs were present, the real CI verification workflow has NO_RUNS
      expect(result.verdict).toBe("NO_RUNS");
      expect(result.isAlarm).toBe(true);
    });

    it("ignores PR branch runs and only considers default branch", () => {
      const runs = [
        {
          id: 301,
          name: "CI",
          head_branch: "dependabot/npm/typescript-7.0.2",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-31T11:00:00Z",
        },
        {
          id: 302,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-31T08:00:00Z", // 4 hours old on main
        },
      ];

      const result = evaluateRepoCiStatus({
        target: moneyTalksTarget,
        runs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("HEALTHY");
      expect(result.latestRunId).toBe(302);
      expect(result.ageHours).toBe(4);
    });

    it("ignores in-progress runs and evaluates latest completed run", () => {
      const runs = [
        {
          id: 401,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "in_progress",
          conclusion: null,
          created_at: "2026-08-31T11:55:00Z",
        },
        {
          id: 402,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "success",
          created_at: "2026-08-31T09:00:00Z", // 3 hours old
        },
      ];

      const result = evaluateRepoCiStatus({
        target: moneyTalksTarget,
        runs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("HEALTHY");
      expect(result.latestRunId).toBe(402);
    });

    it("treats MoneyTalks run as HEALTHY when ONLY contracts-freshness (advisory) fails", () => {
      const runs = [
        {
          id: 501,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "failure", // overall workflow failed on GH
          created_at: "2026-08-31T10:00:00Z",
        },
      ];

      const jobs = [
        { name: "verify", status: "completed", conclusion: "success" },
        { name: "engine-fixtures-ts", status: "completed", conclusion: "success" },
        { name: "contracts-freshness", status: "completed", conclusion: "failure" }, // advisory
      ];

      const result = evaluateRepoCiStatus({
        target: moneyTalksTarget,
        runs,
        jobs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("HEALTHY");
      expect(result.isAlarm).toBe(false);
      expect(result.details).toContain("contracts-freshness");
    });

    it("treats MoneyTalks run as RED when verify (core verification) fails", () => {
      const runs = [
        {
          id: 502,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "failure",
          created_at: "2026-08-31T10:00:00Z",
        },
      ];

      const jobs = [
        { name: "verify", status: "completed", conclusion: "failure" }, // core verification failed
        { name: "engine-fixtures-ts", status: "completed", conclusion: "success" },
        { name: "contracts-freshness", status: "completed", conclusion: "success" },
      ];

      const result = evaluateRepoCiStatus({
        target: moneyTalksTarget,
        runs,
        jobs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("RED");
      expect(result.isAlarm).toBe(true);
    });

    it("treats MoneyTalks run as RED when both verify and contracts-freshness fail", () => {
      const runs = [
        {
          id: 503,
          name: "CI",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "failure",
          created_at: "2026-08-31T10:00:00Z",
        },
      ];

      const jobs = [
        { name: "verify", status: "completed", conclusion: "failure" },
        { name: "engine-fixtures-ts", status: "completed", conclusion: "success" },
        { name: "contracts-freshness", status: "completed", conclusion: "failure" },
      ];

      const result = evaluateRepoCiStatus({
        target: moneyTalksTarget,
        runs,
        jobs,
        now: BASE_DATE,
      });

      expect(result.verdict).toBe("RED");
      expect(result.isAlarm).toBe(true);
    });

    it("evaluates authError as AUTH_REQUIRED alarm", () => {
      const result = evaluateRepoCiStatus({
        target: pickleballTarget,
        runs: [],
        authError: "HTTP 404 (Private repo inaccessible without token)",
      });

      expect(result.verdict).toBe("AUTH_REQUIRED");
      expect(result.isAlarm).toBe(true);
      expect(result.details).toContain("HTTP 404");
    });
  });

  describe("Formatting", () => {
    it("formats markdown table and summary verdicts properly", () => {
      const results = [
        evaluateRepoCiStatus({
          target: moneyTalksTarget,
          runs: [
            {
              id: 101,
              name: "CI",
              head_branch: "main",
              path: ".github/workflows/ci.yml",
              status: "completed",
              conclusion: "success",
              created_at: "2026-08-31T10:00:00Z",
            },
          ],
          now: BASE_DATE,
        }),
        evaluateRepoCiStatus({
          target: returnSaasTarget,
          runs: [],
          now: BASE_DATE,
        }),
      ];

      const table = formatMarkdownTable(results);
      expect(table).toContain("| Repo | Branch | Workflow | Run ID | Conclusion | Age (h) | Verdict | Status |");
      expect(table).toContain("| MoneyTalks | main | ci.yml | 101 | success | 2h | HEALTHY | 🟢 OK |");
      expect(table).toContain("| return-saas | organized | ci.yml | — | — | — | NO_RUNS | 🔴 ALARM |");

      const verdicts = formatVerdicts(results);
      expect(verdicts[0]).toContain("✅ MoneyTalks (main): [HEALTHY]");
      expect(verdicts[1]).toContain("❌ return-saas (organized): [NO_RUNS]");
    });
  });
});
