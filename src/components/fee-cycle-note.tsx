import { formatMinorUnits, type Currency } from "@/engine/money";
import { feeCycleDaysRemaining, type FeeCycle } from "@/lib/cards/feeSchedule";

/**
 * The annual-fee countdown. Deliberately phrased around the DECISION, not the
 * charge: "fee renews soon" is an announcement, "cancel by the 14th to recover
 * $150" is something the user can act on.
 */

function formatDayUTC(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

function plural(days: number) {
  return days === 1 ? "day" : "days";
}

export function FeeCycleNote({
  cycle,
  today,
  currency = "CAD",
  className = "",
}: {
  cycle: FeeCycle;
  today: Date;
  currency?: Currency;
  className?: string;
}) {
  const days = feeCycleDaysRemaining(cycle, today);
  const amount = formatMinorUnits(cycle.feeMinor, currency);

  if (cycle.phase === "DECISION_WINDOW") {
    return (
      <span className={`text-xs font-medium text-amber-700 dark:text-amber-500 ${className}`}>
        {days === 0
          ? `Last day to cancel and recover ${amount}`
          : `Cancel by ${formatDayUTC(cycle.cancelBy)} (${days} ${plural(days)}) to recover ${amount}`}
      </span>
    );
  }

  return (
    <span className={`text-xs text-muted-foreground ${className}`}>
      {amount} fee posts {formatDayUTC(cycle.postsOn)} (in {days} {plural(days)})
    </span>
  );
}
