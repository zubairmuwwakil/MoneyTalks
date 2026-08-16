import { AlertTriangle, Info, RotateCcw, ShieldAlert, X } from "lucide-react";
import type { RuleAlert } from "@/engine/rules/types";
import { formatMinorUnits } from "@/engine/money";
import { dismissAlert, restoreAlert } from "@/app/money-finder/actions";
import { Badge } from "@/components/ui/badge";

const SEVERITY_CONFIG: Record<
  RuleAlert["severity"],
  {
    border: string;
    bg: string;
    badgeVariant: "destructive" | "warning" | "info";
    icon: typeof ShieldAlert;
    iconColor: string;
  }
> = {
  critical: {
    border: "border-l-red-600 border-red-500/20",
    bg: "bg-red-500/5",
    badgeVariant: "destructive",
    icon: ShieldAlert,
    iconColor: "text-red-600",
  },
  warning: {
    border: "border-l-amber-500 border-amber-500/20",
    bg: "bg-amber-500/5",
    badgeVariant: "warning",
    icon: AlertTriangle,
    iconColor: "text-amber-600",
  },
  info: {
    border: "border-l-sky-500 border-border/80",
    bg: "bg-card",
    badgeVariant: "info",
    icon: Info,
    iconColor: "text-sky-600",
  },
};

export function AlertCard({ alert, mode }: { alert: RuleAlert; mode: "active" | "dismissed" }) {
  const config = SEVERITY_CONFIG[alert.severity];
  const Icon = config.icon;

  return (
    <div
      data-testid="alert-card"
      className={`rounded-xl border border-l-4 p-5 shadow-2xs transition-shadow hover:shadow-xs ${config.border} ${config.bg}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Icon className={`size-4.5 shrink-0 ${config.iconColor}`} />
          <p className="font-semibold text-sm sm:text-base text-foreground tracking-tight">{alert.title}</p>
        </div>
        {alert.valueMinor !== undefined && alert.valueCurrency ? (
          <Badge variant="secondary" className="whitespace-nowrap tabular-nums text-xs font-semibold">
            {formatMinorUnits(alert.valueMinor, alert.valueCurrency)}
          </Badge>
        ) : null}
      </div>

      <p className="mt-2 text-xs sm:text-sm text-foreground/85 leading-relaxed">{alert.message}</p>

      <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span>→ {alert.action}</span>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
        <span className="text-[11px] font-mono text-muted-foreground/80">{alert.citation}</span>
        <form action={mode === "active" ? dismissAlert : restoreAlert}>
          <input type="hidden" name="ruleKey" value={alert.ruleKey} />
          <input type="hidden" name="entityRef" value={alert.entityRef} />
          <button
            type="submit"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline hover:text-foreground cursor-pointer"
          >
            {mode === "active" ? (
              <>
                <X className="size-3" />
                <span>dismiss</span>
              </>
            ) : (
              <>
                <RotateCcw className="size-3" />
                <span>restore</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
