import { CreditCard, DollarSign, Gift, CalendarClock, AlertCircle, CheckCircle2 } from "lucide-react";
import { formatMinorUnits } from "@/engine/money";
import { Card, CardContent } from "@/components/ui/card";

export interface WalletSummaryStats {
  totalAnnualFeeMinor: number;
  totalGrossFeeMinor: number;
  totalCreditsCad: number;
  cardCount: number;
  networkCounts: { amex: number; visa: number; mastercard: number; other: number };
  missingRenewalDateCount: number;
  closestRenewalNote: string | null;
  closestRenewalDays: number | null;
  decisionWindowCount: number;
}

export function WalletSummaryBar({
  stats,
  onOpenRenewalManager,
}: {
  stats: WalletSummaryStats;
  onOpenRenewalManager?: () => void;
}) {
  const isSavingOnFees = stats.totalGrossFeeMinor > stats.totalAnnualFeeMinor;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* 1. Total Annual Fees */}
      <Card className="border-border/80 bg-card/60 backdrop-blur-xs transition-shadow hover:shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span className="text-xs font-medium tracking-tight">Annual Fees</span>
            <DollarSign className="size-4 text-muted-foreground/70" />
          </div>
          <div className="mt-2">
            <p className="text-xl font-bold tracking-tight tabular-nums sm:text-2xl">
              {formatMinorUnits(stats.totalAnnualFeeMinor, "CAD")}
              <span className="text-xs font-normal text-muted-foreground">/yr</span>
            </p>
            {isSavingOnFees ? (
              <p className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                Saved {formatMinorUnits(stats.totalGrossFeeMinor - stats.totalAnnualFeeMinor, "CAD")} in bank rebates
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground">Across your active portfolio</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2. Total Credits Unlocked */}
      <Card className="border-border/80 bg-card/60 backdrop-blur-xs transition-shadow hover:shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span className="text-xs font-medium tracking-tight">Credits & Perks</span>
            <Gift className="size-4 text-muted-foreground/70" />
          </div>
          <div className="mt-2">
            <p className="text-xl font-bold tracking-tight tabular-nums sm:text-2xl text-emerald-600 dark:text-emerald-400">
              ${stats.totalCreditsCad.toFixed(0)}
              <span className="text-xs font-normal text-muted-foreground">/yr</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Travel & dining credits</p>
          </div>
        </CardContent>
      </Card>

      {/* 3. Cards in Wallet */}
      <Card className="border-border/80 bg-card/60 backdrop-blur-xs transition-shadow hover:shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span className="text-xs font-medium tracking-tight">Wallet Portfolio</span>
            <CreditCard className="size-4 text-muted-foreground/70" />
          </div>
          <div className="mt-2">
            <p className="text-xl font-bold tracking-tight tabular-nums sm:text-2xl">
              {stats.cardCount}{" "}
              <span className="text-xs font-normal text-muted-foreground">Cards</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {stats.networkCounts.amex > 0 ? `${stats.networkCounts.amex} Amex · ` : ""}
              {stats.networkCounts.visa > 0 ? `${stats.networkCounts.visa} Visa · ` : ""}
              {stats.networkCounts.mastercard > 0 ? `${stats.networkCounts.mastercard} MC` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 4. Renewal Status */}
      <Card
        className={`border-border/80 bg-card/60 backdrop-blur-xs transition-all ${
          stats.missingRenewalDateCount > 0 ? "cursor-pointer hover:border-amber-500/50" : ""
        }`}
        onClick={stats.missingRenewalDateCount > 0 ? onOpenRenewalManager : undefined}
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span className="text-xs font-medium tracking-tight">Fee Renewals</span>
            <CalendarClock className="size-4 text-muted-foreground/70" />
          </div>
          <div className="mt-2">
            {stats.decisionWindowCount > 0 ? (
              <>
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-4 shrink-0" />
                  <p className="text-sm font-semibold tracking-tight">Decision Open</p>
                </div>
                <p className="mt-0.5 text-[11px] text-amber-700/90 dark:text-amber-400/90">
                  Grace period active to recover fee
                </p>
              </>
            ) : stats.missingRenewalDateCount > 0 ? (
              <>
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-4 shrink-0" />
                  <p className="text-sm font-semibold tracking-tight">
                    {stats.missingRenewalDateCount} Missing Date{stats.missingRenewalDateCount > 1 ? "s" : ""}
                  </p>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground underline underline-offset-2">
                  Click to set dates
                </p>
              </>
            ) : stats.closestRenewalNote ? (
              <>
                <p className="text-sm font-semibold tracking-tight truncate text-foreground">
                  {stats.closestRenewalDays !== null ? `In ${stats.closestRenewalDays} days` : "Scheduled"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                  {stats.closestRenewalNote}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <p className="text-sm font-semibold tracking-tight">Up to date</p>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">No upcoming fees</p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
