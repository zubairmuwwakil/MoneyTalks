"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  HelpCircle,
  Info,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AccountDataHealthReport,
  AccountHealthIssue,
} from "@/lib/domain/investments/accountDataHealth";
import { triggerHaptic } from "./account-detail-client";

export function AccountStatusBadge({ status }: { status: AccountDataHealthReport["status"] }) {
  if (status === "tracking") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 text-xs">
        <CheckCircle2 className="size-3" />
        <span>Tracking</span>
      </Badge>
    );
  }

  if (status === "incomplete") {
    return (
      <Badge variant="warning" className="gap-1 text-xs">
        <AlertCircle className="size-3" />
        <span>Data Incomplete</span>
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <Info className="size-3" />
      <span>Needs Setup</span>
    </Badge>
  );
}

export function HoldingHealthBadge({
  symbol,
  report,
  priceAsOf,
  priceStatus,
  priceCurrency,
  accountCurrency,
  lastPriceMinor,
}: {
  symbol: string;
  report: AccountDataHealthReport;
  priceAsOf: Date | string;
  priceStatus: string | null;
  priceCurrency: string | null;
  accountCurrency: string;
  lastPriceMinor: number;
}) {
  const asOfStr = priceAsOf instanceof Date ? priceAsOf.toISOString().slice(0, 10) : String(priceAsOf).slice(0, 10);

  if (!lastPriceMinor || lastPriceMinor <= 0) {
    return (
      <Badge variant="destructive" className="text-[10px] gap-1 px-1.5 py-0">
        <AlertCircle className="size-2.5" />
        <span>No price</span>
      </Badge>
    );
  }

  const isMissingFx = report.holdingsHealth.missingFxHoldings.some((h) => h.symbol === symbol);
  if (isMissingFx && priceCurrency) {
    return (
      <Badge variant="destructive" className="text-[10px] gap-1 px-1.5 py-0">
        <Coins className="size-2.5" />
        <span>No FX ({priceCurrency}→{accountCurrency})</span>
      </Badge>
    );
  }

  const isAssumed = report.holdingsHealth.assumedCurrencyHoldings.includes(symbol);
  if (isAssumed) {
    return (
      <Badge variant="outline" className="text-[10px] gap-1 text-amber-700 dark:text-amber-400 border-amber-500/40 px-1.5 py-0">
        <HelpCircle className="size-2.5" />
        <span>Assumed {accountCurrency}</span>
      </Badge>
    );
  }

  const isStale =
    priceStatus?.toUpperCase() === "STALE" ||
    priceStatus?.toUpperCase() === "UNAVAILABLE" ||
    asOfStr < report.expectedCaptureDate;

  if (isStale) {
    return (
      <Badge variant="outline" className="text-[10px] gap-1 text-amber-700 dark:text-amber-400 border-amber-500/40 px-1.5 py-0">
        <Clock className="size-2.5" />
        <span>Quote {asOfStr}</span>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-[10px] gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 px-1.5 py-0">
      <CheckCircle2 className="size-2.5" />
      <span>Fresh</span>
    </Badge>
  );
}

function IssueItem({ issue }: { issue: AccountHealthIssue }) {
  const Icon =
    issue.severity === "error"
      ? AlertCircle
      : issue.severity === "warning"
      ? AlertTriangle
      : Info;

  const iconColor =
    issue.severity === "error"
      ? "text-rose-600 dark:text-rose-400"
      : issue.severity === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-blue-600 dark:text-blue-400";

  return (
    <li className="flex items-start gap-2.5 text-xs">
      <Icon className={`size-4 shrink-0 mt-0.5 ${iconColor}`} />
      <div className="space-y-0.5 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="font-semibold text-foreground">{issue.title}</p>
          {issue.affectedSymbols && issue.affectedSymbols.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {issue.affectedSymbols.map((sym) => (
                <code
                  key={sym}
                  className="rounded bg-muted px-1 py-0.2 font-mono text-[10px] font-semibold text-foreground"
                >
                  {sym}
                </code>
              ))}
            </div>
          ) : null}
        </div>
        <p className="text-muted-foreground leading-relaxed">{issue.description}</p>
        {issue.actionHint ? (
          <p className="text-[11px] font-medium text-foreground/80">
            → {issue.actionHint}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function AccountDataHealthCard({
  report,
  accountId,
  refreshAction,
  isCrypto,
}: {
  report: AccountDataHealthReport;
  accountId: string;
  refreshAction: (formData: FormData) => Promise<void>;
  isCrypto: boolean;
}) {
  void isCrypto;
  const [isPending, startTransition] = useTransition();
  const [isExpanded, setIsExpanded] = useState(true);

  const handleRefresh = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    triggerHaptic(20);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await refreshAction(formData);
    });
  };

  if (report.status === "tracking") {
    return (
      <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <p className="font-medium">
            <strong>Data complete:</strong> Performance tracking is active with complete daily valuations
            {report.latestCompleteAsOf ? ` (latest close: ${report.latestCompleteAsOf})` : ""}.
          </p>
        </div>
      </div>
    );
  }

  if (report.status === "needs-setup") {
    return (
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-xs text-blue-900 dark:text-blue-200 space-y-2">
        <div className="flex items-start gap-2.5">
          <Info className="size-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-sm">Account Setup Needed</p>
            <p className="text-muted-foreground leading-relaxed">
              Add holdings positions or record a cash balance below. Once recorded, daily performance tracking begins after the next complete close.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // "incomplete" status: Render full diagnostic health card
  const errorCount = report.issues.filter((i) => i.severity === "error").length;
  const warningCount = report.issues.filter((i) => i.severity === "warning").length;

  return (
    <section
      aria-labelledby="data-health-heading"
      className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-4 sm:p-5 text-xs text-amber-950 dark:text-amber-100 shadow-2xs space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-amber-500/20 pb-3">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <h2 id="data-health-heading" className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
              <span>Why Data is Incomplete for this Account</span>
              <Badge variant="warning" className="text-[10px] uppercase font-semibold">
                {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? "s" : ""}` : ""}
                {errorCount > 0 && warningCount > 0 ? " · " : ""}
                {warningCount > 0 ? `${warningCount} warning${warningCount > 1 ? "s" : ""}` : ""}
              </Badge>
            </h2>
            <p className="mt-0.5 text-muted-foreground text-[11px]">
              Daily returns exclude partial or out-of-date days. Below is what is preventing complete tracking.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <form onSubmit={handleRefresh}>
            <input type="hidden" name="accountId" value={accountId} />
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="h-8 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 font-medium text-xs shadow-xs"
            >
              <RefreshCw className={`size-3.5 ${isPending ? "animate-spin" : ""}`} />
              <span>{isPending ? "Refreshing..." : "Refresh Prices & Capture"}</span>
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md"
            aria-label={isExpanded ? "Collapse issues breakdown" : "Expand issues breakdown"}
          >
            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="space-y-3 pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Diagnosed Issues & Fixes
          </p>
          <ul className="divide-y divide-amber-500/15 rounded-lg border border-amber-500/20 bg-background/80 p-3 space-y-3">
            {report.issues.map((issue) => (
              <div key={issue.id} className="pt-2 first:pt-0">
                <IssueItem issue={issue} />
              </div>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
