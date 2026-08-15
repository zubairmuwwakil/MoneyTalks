import { THRESHOLDS } from "./thresholds";
import type { FinancialSnapshot, ProfileView, Rule, RuleAlert } from "./types";

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

export function evaluateRules(
  profile: ProfileView,
  snapshot: FinancialSnapshot,
  rules: Rule[],
): { alerts: RuleAlert[]; errors: Array<{ ruleKey: string; message: string }> } {
  const alerts: RuleAlert[] = [];
  const errors: Array<{ ruleKey: string; message: string }> = [];

  for (const rule of rules) {
    try {
      alerts.push(...rule.evaluate(profile, snapshot));
    } catch (e) {
      errors.push({ ruleKey: rule.key, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const staleCutoff = new Date(snapshot.today).getTime() - THRESHOLDS.RULE_REVIEW_STALE_DAYS * 86_400_000;
  const staleKeys = rules.filter((r) => new Date(r.lastReviewed).getTime() < staleCutoff).map((r) => r.key);
  if (staleKeys.length > 0) {
    alerts.push({
      ruleKey: "RULES_STALE",
      severity: "info",
      kind: "compliance",
      entityRef: "",
      title: "Some rules need a review",
      message: `These rules were last verified over a year ago: ${staleKeys.join(", ")}. Their thresholds may be outdated.`,
      action: "Re-verify the cited sources and update lastReviewed in the rule definitions.",
      citation: "Internal freshness policy",
    });
  }

  alerts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.valueMinor ?? 0) - (a.valueMinor ?? 0),
  );
  return { alerts, errors };
}

export function applyDismissals(
  alerts: RuleAlert[],
  dismissals: Array<{ ruleKey: string; entityRef: string }>,
): { active: RuleAlert[]; dismissed: RuleAlert[] } {
  const keys = new Set(dismissals.map((d) => `${d.ruleKey} ${d.entityRef}`));
  const active: RuleAlert[] = [];
  const dismissed: RuleAlert[] = [];
  for (const alert of alerts) {
    (keys.has(`${alert.ruleKey} ${alert.entityRef}`) ? dismissed : active).push(alert);
  }
  return { active, dismissed };
}
