import type { RuleAlert } from "@/engine/rules/types";
import { formatMinorUnits } from "@/engine/money";
import { dismissAlert, restoreAlert } from "@/app/money-finder/actions";

const SEVERITY_STYLES: Record<RuleAlert["severity"], string> = {
  critical: "border-red-600",
  warning: "border-amber-500",
  info: "border-border",
};

export function AlertCard({ alert, mode }: { alert: RuleAlert; mode: "active" | "dismissed" }) {
  return (
    <div data-testid="alert-card" className={`rounded border-l-4 p-4 ${SEVERITY_STYLES[alert.severity]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{alert.title}</p>
        {alert.valueMinor !== undefined && alert.valueCurrency ? (
          <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            {formatMinorUnits(alert.valueMinor, alert.valueCurrency)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm">{alert.message}</p>
      <p className="mt-2 text-sm text-muted-foreground">→ {alert.action}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{alert.citation}</span>
        <form action={mode === "active" ? dismissAlert : restoreAlert}>
          <input type="hidden" name="ruleKey" value={alert.ruleKey} />
          <input type="hidden" name="entityRef" value={alert.entityRef} />
          <button type="submit" className="underline">
            {mode === "active" ? "dismiss" : "restore"}
          </button>
        </form>
      </div>
    </div>
  );
}
