"use client";

import { useState, useTransition, useEffect } from "react";
import {
  RefreshCw,
  Copy,
  Check,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  X,
  Plus,
  Minus,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMinorUnits, minorToDollarInput, parseDollarsToMinor, type Currency } from "@/engine/money";

// ---------------------------------------------------------------------------
// Haptic Feedback Utility
// ---------------------------------------------------------------------------
export function triggerHaptic(duration = 10) {
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(duration);
    } catch {
      // Ignore vibration errors if not supported/permitted
    }
  }
}

// ---------------------------------------------------------------------------
// URL Status Cleaner & Banner
// ---------------------------------------------------------------------------
export function UrlStatusBanner({
  pricesOk,
  pricesError,
  error,
  errorForm,
}: {
  pricesOk?: string;
  pricesError?: string;
  error?: string;
  errorForm?: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Automatically clean up the query string so the message does not persist on reload
    if (typeof window !== "undefined" && (pricesOk || pricesError || error)) {
      const url = new URL(window.location.href);
      url.searchParams.delete("pricesOk");
      url.searchParams.delete("pricesError");
      url.searchParams.delete("error");
      url.searchParams.delete("errorForm");
      const nextQuery = url.searchParams.toString();
      const nextUrl = url.pathname + (nextQuery ? `?${nextQuery}` : "");
      window.history.replaceState({}, "", nextUrl);
    }
  }, [pricesOk, pricesError, error, errorForm]);

  if (dismissed) return null;

  if (pricesOk) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:text-emerald-300 animate-in fade-in-0 duration-200">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-semibold">Price Sync Complete</p>
            <p className="mt-0.5 text-emerald-700 dark:text-emerald-300/90">{pricesOk}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-md p-1 hover:bg-emerald-500/20 transition-colors"
          aria-label="Dismiss price sync notification"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (pricesError) {
    const isUnreachable = pricesError.toLowerCase().includes("unreachable") || pricesError.toLowerCase().includes("not configured");
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 animate-in fade-in-0 duration-200">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Market Data Notice</p>
            <p className="text-amber-800 dark:text-amber-300/90 leading-relaxed">{pricesError}</p>
            {isUnreachable ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400/80">
                Tip: Your current portfolio balances and holding values remain safely preserved with their last recorded closing prices.
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-md p-1 hover:bg-amber-500/20 transition-colors"
          aria-label="Dismiss notice"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive animate-in fade-in-0 duration-200" role="alert">
        <div className="flex items-center gap-2.5">
          <AlertCircle className="size-4 shrink-0" />
          <div>
            <p className="font-semibold">{errorForm ? `Error in ${errorForm}` : "Action Error"}</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-md p-1 hover:bg-destructive/20 transition-colors"
          aria-label="Dismiss error"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Interactive Price Refresh Button with Spinner & Haptic Feedback
// ---------------------------------------------------------------------------
export function RefreshPricesButton({
  accountId,
  action,
  isCrypto,
}: {
  accountId: string;
  action: (formData: FormData) => Promise<void>;
  isCrypto: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    triggerHaptic(15);
    const formData = new FormData();
    formData.append("accountId", accountId);

    startTransition(async () => {
      await action(formData);
    });
  }

  return (
    <form onSubmit={handleClick} className="inline-block">
      <input type="hidden" name="accountId" value={accountId} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 backdrop-blur-xs px-3 text-xs font-medium text-foreground shadow-2xs hover:bg-muted/80 hover:text-foreground active:scale-[0.97] transition-all disabled:opacity-60 cursor-pointer"
        title={
          isCrypto
            ? "Best-effort: fetches spot prices from CoinGecko. Manual entry always works."
            : "Fetches the latest daily close from MarketLens. Not real-time. Manual entry always works."
        }
      >
        <RefreshCw className={`size-3.5 ${isPending ? "animate-spin text-primary" : "text-muted-foreground"}`} />
        <span>{isPending ? "Syncing prices..." : "↻ Refresh prices"}</span>
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Copyable Ticker Symbol Badge
// ---------------------------------------------------------------------------
export function CopyTickerBadge({ symbol }: { symbol: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    triggerHaptic(8);
    navigator.clipboard.writeText(symbol);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy ticker symbol"
      className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 hover:bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-foreground transition-colors group cursor-pointer"
    >
      <span>{symbol}</span>
      {copied ? (
        <Check className="size-3 text-emerald-600 dark:text-emerald-400 animate-in zoom-in-50" />
      ) : (
        <Copy className="size-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Visual Portfolio Allocation Bar
// ---------------------------------------------------------------------------
const ALLOCATION_PALETTE = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-cyan-500",
  "bg-orange-500",
];

export interface AllocationItem {
  id: string;
  symbol: string;
  name: string;
  valueMinor: number;
}

export function PortfolioAllocationBar({
  cashMinor,
  currency,
  holdings,
}: {
  cashMinor: number;
  currency: Currency;
  holdings: AllocationItem[];
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const validCash = Math.max(0, cashMinor);
  const totalHoldingsValue = holdings.reduce((sum, h) => sum + Math.max(0, h.valueMinor), 0);
  const totalValue = validCash + totalHoldingsValue;

  if (totalValue <= 0) return null;

  // Build allocation segments
  const segments = [
    ...holdings.map((h, i) => ({
      id: h.id,
      label: h.symbol,
      subLabel: h.name,
      valueMinor: Math.max(0, h.valueMinor),
      percentage: totalValue > 0 ? (Math.max(0, h.valueMinor) / totalValue) * 100 : 0,
      color: ALLOCATION_PALETTE[i % ALLOCATION_PALETTE.length],
      isCash: false,
    })),
    ...(validCash > 0
      ? [
          {
            id: "cash-segment",
            label: "Cash",
            subLabel: "Uninvested balance",
            valueMinor: validCash,
            percentage: (validCash / totalValue) * 100,
            color: "bg-zinc-400 dark:bg-zinc-600",
            isCash: true,
          },
        ]
      : []),
  ]
    .filter((s) => s.valueMinor > 0)
    .sort((a, b) => b.valueMinor - a.valueMinor);

  return (
    <div className="mt-4 pt-4 border-t border-border/60">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Layers className="size-3.5" />
          <span>Asset Allocation</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {segments.length} {segments.length === 1 ? "asset" : "assets"} · Total {formatMinorUnits(totalValue, currency)}
        </span>
      </div>

      {/* Stacked Progress Bar */}
      <div className="relative flex h-3 w-full overflow-hidden rounded-full bg-muted/60 p-0.5 shadow-inner">
        {segments.map((seg) => (
          <div
            key={seg.id}
            onMouseEnter={() => setHoveredId(seg.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ width: `${Math.max(seg.percentage, 1.5)}%` }}
            className={`h-full ${seg.color} transition-all duration-200 relative first:rounded-l-full last:rounded-r-full cursor-pointer ${
              hoveredId === seg.id ? "brightness-110 ring-2 ring-foreground/20 z-10 scale-y-125" : "hover:brightness-105"
            }`}
            title={`${seg.label}: ${seg.percentage.toFixed(1)}% (${formatMinorUnits(seg.valueMinor, currency)})`}
          />
        ))}
      </div>

      {/* Allocation Chips Legend */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {segments.map((seg) => {
          const isHovered = hoveredId === seg.id;
          return (
            <div
              key={seg.id}
              onMouseEnter={() => setHoveredId(seg.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors cursor-pointer ${
                isHovered ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`size-2 rounded-full ${seg.color} shrink-0`} />
              <span className="font-semibold text-foreground">{seg.label}</span>
              <span className="tabular-nums text-muted-foreground font-mono text-[11px]">
                {seg.percentage.toFixed(1)}%
              </span>
              <span className="text-[11px] text-muted-foreground/75 hidden sm:inline">
                ({formatMinorUnits(seg.valueMinor, currency)})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Polished "Set Cash" Modal Dialog
// ---------------------------------------------------------------------------
export function SetCashModal({
  accountId,
  currentCashMinor,
  currency,
  action,
}: {
  accountId: string;
  currentCashMinor: number;
  currency: Currency;
  action: (formData: FormData) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"set" | "deposit" | "withdraw">("set");
  const [inputValue, setInputValue] = useState(minorToDollarInput(currentCashMinor));

  function handleOpen() {
    triggerHaptic(10);
    setInputValue(minorToDollarInput(currentCashMinor));
    setMode("set");
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
  }

  // Calculate projected new balance
  const parsedInputMinor = parseDollarsToMinor(inputValue) ?? 0;
  let finalMinor = currentCashMinor;
  if (mode === "set") {
    finalMinor = parsedInputMinor;
  } else if (mode === "deposit") {
    finalMinor = currentCashMinor + Math.abs(parsedInputMinor);
  } else if (mode === "withdraw") {
    finalMinor = currentCashMinor - Math.abs(parsedInputMinor);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    triggerHaptic(15);

    const formData = new FormData();
    formData.append("accountId", accountId);
    formData.append("cashBalance", minorToDollarInput(finalMinor));

    startTransition(async () => {
      await action(formData);
      setIsOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 rounded-md bg-muted/60 hover:bg-muted px-2 py-0.5 text-xs font-semibold text-foreground transition-colors cursor-pointer active:scale-95 ml-1"
        title="Adjust uninvested cash balance"
      >
        <DollarSign className="size-3 text-muted-foreground" />
        <span>[Set cash]</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in-0">
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <DollarSign className="size-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold tracking-tight">Set Cash Balance</h3>
                  <p className="text-xs text-muted-foreground">Manage uninvested account cash</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Current Balance Display */}
            <div className="my-4 rounded-xl bg-muted/40 p-3.5 flex items-center justify-between border border-border/60">
              <div>
                <span className="text-xs text-muted-foreground">Current Uninvested Cash</span>
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {formatMinorUnits(currentCashMinor, currency)}
                </p>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                {currency}
              </Badge>
            </div>

            {/* Mode Selectors */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-muted/60 rounded-xl mb-4 text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(5);
                  setMode("set");
                  setInputValue(minorToDollarInput(currentCashMinor));
                }}
                className={`py-1.5 rounded-lg transition-all ${
                  mode === "set" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Set Total
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(5);
                  setMode("deposit");
                  setInputValue("100.00");
                }}
                className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${
                  mode === "deposit" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Plus className="size-3 text-emerald-600" />
                <span>Deposit</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(5);
                  setMode("withdraw");
                  setInputValue("50.00");
                }}
                className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${
                  mode === "withdraw" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Minus className="size-3 text-rose-600" />
                <span>Withdraw</span>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  {mode === "set" ? "New Total Cash ($)" : mode === "deposit" ? "Deposit Amount ($)" : "Withdrawal Amount ($)"}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    required
                    placeholder="0.00"
                    autoFocus
                    className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-base font-semibold tabular-nums shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Projected Total Preview */}
              {mode !== "set" ? (
                <div className="rounded-lg bg-muted/20 p-2.5 text-xs flex items-center justify-between border border-border/50">
                  <span className="text-muted-foreground">Projected New Balance:</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatMinorUnits(finalMinor, currency)}
                  </span>
                </div>
              ) : null}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending} className="min-w-[90px]">
                  {isPending ? "Saving..." : "Save Cash"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Quick Tab Navigation Component
// ---------------------------------------------------------------------------
export function AccountTabNav({
  holdingsCount,
  transactionsCount,
  snapshotsCount,
}: {
  holdingsCount: number;
  transactionsCount: number;
  snapshotsCount: number;
}) {
  function scrollToSection(id: string) {
    triggerHaptic(6);
    const elem = document.getElementById(id);
    if (elem) {
      elem.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="sticky top-14 z-20 flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border/80 bg-background/90 p-1.5 backdrop-blur-md shadow-xs">
      <button
        type="button"
        onClick={() => scrollToSection("section-holdings")}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
      >
        <span>Holdings</span>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-mono">
          {holdingsCount}
        </Badge>
      </button>
      <button
        type="button"
        onClick={() => scrollToSection("section-transactions")}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
      >
        <span>Transactions</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-mono">
          {transactionsCount}
        </Badge>
      </button>
      <button
        type="button"
        onClick={() => scrollToSection("section-snapshots")}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
      >
        <span>Snapshots</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-mono">
          {snapshotsCount}
        </Badge>
      </button>
      <button
        type="button"
        onClick={() => scrollToSection("section-details")}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
      >
        <span>Account Details</span>
      </button>
    </div>
  );
}
