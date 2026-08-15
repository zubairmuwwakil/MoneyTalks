import { describe, expect, it } from "vitest";
import { makeProfile, makeSnapshot } from "./fixtures";
import { applyDismissals, evaluateRules } from "./registry";
import type { Rule, RuleAlert } from "./types";

const okAlert: RuleAlert = {
  ruleKey: "OK_RULE",
  severity: "info",
  kind: "opportunity",
  entityRef: "",
  title: "ok",
  message: "m",
  action: "a",
  citation: "c",
};

const okRule: Rule = {
  key: "OK_RULE",
  jurisdiction: "CA",
  kind: "opportunity",
  citation: "c",
  lastReviewed: "2026-08-14",
  evaluate: () => [okAlert],
};

const throwingRule: Rule = {
  key: "BROKEN_RULE",
  jurisdiction: "CA",
  kind: "compliance",
  citation: "c",
  lastReviewed: "2026-08-14",
  evaluate: () => {
    throw new Error("boom");
  },
};

const criticalRule: Rule = {
  key: "CRIT_RULE",
  jurisdiction: "US",
  kind: "compliance",
  citation: "c",
  lastReviewed: "2026-08-14",
  evaluate: () => [{ ...okAlert, ruleKey: "CRIT_RULE", severity: "critical", kind: "compliance" }],
};

const staleRule: Rule = { ...okRule, key: "OLD_RULE", lastReviewed: "2024-01-01", evaluate: () => [] };

describe("evaluateRules", () => {
  const profile = makeProfile();
  const snapshot = makeSnapshot([]);

  it("collects alerts and isolates throwing rules as errors", () => {
    const { alerts, errors } = evaluateRules(profile, snapshot, [okRule, throwingRule]);
    expect(alerts.some((a) => a.ruleKey === "OK_RULE")).toBe(true);
    expect(errors).toEqual([{ ruleKey: "BROKEN_RULE", message: "boom" }]);
  });

  it("sorts critical before info", () => {
    const { alerts } = evaluateRules(profile, snapshot, [okRule, criticalRule]);
    expect(alerts[0].ruleKey).toBe("CRIT_RULE");
  });

  it("flags rules not reviewed within 365 days", () => {
    const { alerts } = evaluateRules(profile, snapshot, [staleRule]);
    expect(alerts.some((a) => a.ruleKey === "RULES_STALE" && a.message.includes("OLD_RULE"))).toBe(true);
  });
});

describe("applyDismissals", () => {
  it("splits active from dismissed by ruleKey + entityRef", () => {
    const alerts = [okAlert, { ...okAlert, entityRef: "h-1" }];
    const { active, dismissed } = applyDismissals(alerts, [{ ruleKey: "OK_RULE", entityRef: "h-1" }]);
    expect(active).toHaveLength(1);
    expect(active[0].entityRef).toBe("");
    expect(dismissed).toHaveLength(1);
  });
});
