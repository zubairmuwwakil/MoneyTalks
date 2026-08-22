"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Copy,
  Check,
  DollarSign,
  X,
  Plus,
  Minus,
  Layers,
  Trash2,
  Edit2,
  TrendingUp,
  Calendar,
  SlidersHorizontal,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMinorUnits, minorToDollarInput, parseDollarsToMinor, type Currency } from "@/engine/money";
import type { ActionResult } from "@/app/investments/actions";

// ---------------------------------------------------------------------------
// Multi-Tiered Tactile Haptics Engine
// ---------------------------------------------------------------------------
export type HapticType = "light" | "medium" | "heavy" | "success" | "warning" | "error";

export function triggerHaptic(type: HapticType | number = "light") {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.vibrate) {
    return;
  }
  try {
    if (typeof type === "number") {
      navigator.vibrate(type);
      return;
    }
    switch (type) {
      case "light":
        navigator.vibrate(8);
        break;
      case "medium":
        navigator.vibrate(18);
        break;
      case "heavy":
        navigator.vibrate(35);
        break;
      case "success":
        navigator.vibrate([12, 40, 20]);
        break;
      case "warning":
        navigator.vibrate([30, 60, 30]);
        break;
      case "error":
        navigator.vibrate([50, 80, 50, 80, 50]);
        break;
    }
  } catch {
    // Vibration not permitted or supported in this browser context
  }
}

// ---------------------------------------------------------------------------
// URL Status Notification Bridge (Fires Sonner Toasts & Cleans URL)
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
  useEffect(() => {
    if (pricesOk) {
      triggerHaptic("success");
      toast.success("Prices Updated", {
        description: pricesOk,
        duration: 4000,
      });
    }
    if (pricesError) {
      triggerHaptic("warning");
      toast.warning("Market Data Notice", {
        description: pricesError,
        duration: 6000,
      });
    }
    if (error) {
      triggerHaptic("error");
      toast.error(errorForm ? `Error in ${errorForm}` : "Action Failed", {
        description: error,
        duration: 5000,
      });
    }

    // Clean up query string from browser history so toasts don't re-fire on refresh
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
    triggerHaptic("medium");
    const formData = new FormData();
    formData.append("accountId", accountId);

    startTransition(async () => {
      try {
        await action(formData);
        triggerHaptic("success");
      } catch (err) {
        triggerHaptic("error");
        toast.error("Failed to sync prices", {
          description: err instanceof Error ? err.message : "Network error",
        });
      }
    });
  }

  return (
    <form onSubmit={handleClick} className="inline-block">
      <input type="hidden" name="accountId" value={accountId} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 px-3 text-xs font-medium text-foreground shadow-2xs hover:bg-muted/80 hover:text-foreground active:scale-[0.97] transition-all disabled:opacity-60 cursor-pointer"
        title={
          isCrypto
            ? "Fetches spot prices from CoinGecko. Manual entry always works."
            : "Fetches latest close from MarketLens. Manual entry always works."
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

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    triggerHaptic("light");
    navigator.clipboard.writeText(symbol);
    setCopied(true);
    toast.success(`Copied ${symbol}`, { duration: 1500 });
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy ticker symbol"
      className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 hover:bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-foreground transition-colors group cursor-pointer active:scale-95"
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
            onMouseEnter={() => {
              triggerHaptic("light");
              setHoveredId(seg.id);
            }}
            onMouseLeave={() => setHoveredId(null)}
            style={{ width: `${Math.max(seg.percentage, 1.5)}%` }}
            className={`h-full ${seg.color} transition-all duration-200 relative first:rounded-l-full last:rounded-r-full cursor-pointer ${
              hoveredId === seg.id ? "brightness-110 ring-2 ring-foreground/30 z-10 scale-y-125" : "hover:brightness-105"
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
              onMouseEnter={() => {
                triggerHaptic("light");
                setHoveredId(seg.id);
              }}
              onMouseLeave={() => setHoveredId(null)}
              className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors cursor-pointer ${
                isHovered ? "bg-muted font-medium text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
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
// Universal Delete Confirmation Dialog
// ---------------------------------------------------------------------------
export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  title,
  description,
  onConfirm,
  isPending,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in-0">
      <div className="relative w-full max-w-sm rounded-2xl border border-destructive/30 bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <Trash2 className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={onConfirm}
            className="gap-1.5"
          >
            {isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            <span>{isPending ? "Deleting..." : "Delete"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Set Cash Modal Dialog
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
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"set" | "deposit" | "withdraw">("set");
  const [inputValue, setInputValue] = useState(minorToDollarInput(currentCashMinor));

  function handleOpen() {
    triggerHaptic("light");
    setInputValue(minorToDollarInput(currentCashMinor));
    setMode("set");
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
  }

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
    triggerHaptic("medium");

    const formData = new FormData();
    formData.append("accountId", accountId);
    formData.append("cashBalance", minorToDollarInput(finalMinor));

    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.success("Cash Balance Updated", {
          description: `New balance: ${formatMinorUnits(finalMinor, currency)}`,
        });
        setIsOpen(false);
      } else {
        triggerHaptic("error");
        toast.error("Failed to update cash", { description: res.error });
      }
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

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-muted/60 rounded-xl mb-4 text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("light");
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
                  triggerHaptic("light");
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
                  triggerHaptic("light");
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

              {mode !== "set" ? (
                <div className="rounded-lg bg-muted/20 p-2.5 text-xs flex items-center justify-between border border-border/50">
                  <span className="text-muted-foreground">Projected New Balance:</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatMinorUnits(finalMinor, currency)}
                  </span>
                </div>
              ) : null}

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
// Add / Edit Holding Modal
// ---------------------------------------------------------------------------
export interface HoldingFormData {
  symbol: string;
  quantity: string;
  bookCost?: string;
  name?: string;
  domicileCountry?: string;
  lastPrice?: string;
  priceAsOf?: string;
}

export function AddHoldingModal({
  isOpen,
  onClose,
  accountId,
  accountCountry,
  accountCurrency,
  action,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountCountry: string;
  accountCurrency: string;
  action: (formData: FormData) => Promise<ActionResult>;
  initialData?: HoldingFormData | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [symbol, setSymbol] = useState(initialData?.symbol ?? "");
  const [quantity, setQuantity] = useState(initialData?.quantity ?? "");
  const [bookCost, setBookCost] = useState(initialData?.bookCost ?? "");
  const [name, setName] = useState(initialData?.name ?? "");
  const [domicileCountry, setDomicileCountry] = useState(initialData?.domicileCountry ?? accountCountry);
  const [lastPrice, setLastPrice] = useState(initialData?.lastPrice ?? "");
  const [priceAsOf, setPriceAsOf] = useState(initialData?.priceAsOf ?? new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (initialData) {
      setSymbol(initialData.symbol);
      setQuantity(initialData.quantity);
      setBookCost(initialData.bookCost ?? "");
      setName(initialData.name ?? "");
      setDomicileCountry(initialData.domicileCountry ?? accountCountry);
      setLastPrice(initialData.lastPrice ?? "");
      setPriceAsOf(initialData.priceAsOf ?? new Date().toISOString().slice(0, 10));
      setShowAdvanced(Boolean(initialData.bookCost || initialData.lastPrice));
    } else {
      setSymbol("");
      setQuantity("");
      setBookCost("");
      setName("");
      setDomicileCountry(accountCountry);
      setLastPrice("");
      setPriceAsOf(new Date().toISOString().slice(0, 10));
      setShowAdvanced(false);
    }
  }, [initialData, accountCountry, isOpen]);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    triggerHaptic("medium");

    const formData = new FormData();
    formData.append("accountId", accountId);
    formData.append("symbol", symbol.trim().toUpperCase());
    formData.append("quantity", quantity.trim());
    if (bookCost) formData.append("bookCost", bookCost.trim());
    if (name) formData.append("name", name.trim());
    if (domicileCountry) formData.append("domicileCountry", domicileCountry.trim().toUpperCase());
    if (lastPrice) formData.append("lastPrice", lastPrice.trim());
    if (priceAsOf) formData.append("priceAsOf", priceAsOf);

    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.success(initialData ? `Updated ${symbol.toUpperCase()}` : `Added ${symbol.toUpperCase()}`, {
          description: `${quantity} shares recorded successfully`,
        });
        onClose();
      } else {
        triggerHaptic("error");
        toast.error("Failed to save holding", { description: res.error });
      }
    });
  }

  function appendTickerSuffix(suffix: string) {
    triggerHaptic("light");
    if (!symbol.endsWith(suffix)) {
      setSymbol((prev) => prev + suffix);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in-0">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plus className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">
                {initialData ? `Edit ${initialData.symbol} Position` : "Add Investment Position"}
              </h3>
              <p className="text-xs text-muted-foreground">Record shares, ticker symbol, and cost basis</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-foreground">Ticker Symbol</label>
                <span className="text-[10px] text-muted-foreground">e.g. TSLA, XEQT.TO</span>
              </div>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                required
                placeholder="e.g. AAPL"
                autoFocus
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono uppercase shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {/* Quick TSX Helper Chips */}
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[10px] text-muted-foreground">Quick suffix:</span>
                <button
                  type="button"
                  onClick={() => appendTickerSuffix(".TO")}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted/80 text-foreground cursor-pointer"
                >
                  +.TO (TSX)
                </button>
                <button
                  type="button"
                  onClick={() => appendTickerSuffix(".V")}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted/80 text-foreground cursor-pointer"
                >
                  +.V (Venture)
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Quantity (Shares / Units)</label>
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
                placeholder="e.g. 100"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm tabular-nums shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Advanced / Optional Fields Toggle */}
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setShowAdvanced(!showAdvanced);
              }}
              className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="size-3.5" />
                <span>Optional Details (Cost Basis, Name, Pricing)</span>
              </span>
              {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>

            {showAdvanced ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/50 animate-in fade-in-50 duration-150">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                    Total Book Cost ({accountCurrency})
                  </label>
                  <input
                    type="text"
                    value={bookCost}
                    onChange={(e) => setBookCost(e.target.value)}
                    placeholder="e.g. 1500.00"
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs tabular-nums"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                    Asset Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Auto-resolved from symbol"
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                    Manual Price ($)
                  </label>
                  <input
                    type="text"
                    value={lastPrice}
                    onChange={(e) => setLastPrice(e.target.value)}
                    placeholder="Auto-quoted if blank"
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs tabular-nums"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                    Domicile Country (2-letter)
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    value={domicileCountry}
                    onChange={(e) => setDomicileCountry(e.target.value.toUpperCase())}
                    placeholder={accountCountry}
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs font-mono uppercase"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending} className="min-w-[100px] gap-1.5">
              {isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              <span>{isPending ? "Saving..." : initialData ? "Update Position" : "Add Position"}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Transaction Modal
// ---------------------------------------------------------------------------
const TX_TYPES = ["BUY", "SELL", "CONTRIBUTION", "WITHDRAWAL", "DIVIDEND", "INTEREST", "FEE"] as const;

export function AddTransactionModal({
  isOpen,
  onClose,
  accountId,
  accountCurrency,
  accountType,
  action,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountCurrency: string;
  accountType: string;
  action: (formData: FormData) => Promise<ActionResult>;
  initialData?: {
    type?: string;
    symbol?: string;
    quantity?: number;
    amount?: string;
  } | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<string>(initialData?.type ?? "BUY");
  const [amount, setAmount] = useState<string>(initialData?.amount ?? "");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState<string>("");
  const [symbol, setSymbol] = useState<string>(initialData?.symbol ?? "");
  const [quantity, setQuantity] = useState<string>(initialData?.quantity ? String(initialData.quantity) : "");
  const [confirmRoth, setConfirmRoth] = useState(false);

  useEffect(() => {
    if (initialData) {
      if (initialData.type) setType(initialData.type);
      if (initialData.symbol) setSymbol(initialData.symbol);
      if (initialData.quantity) setQuantity(String(initialData.quantity));
      if (initialData.amount) setAmount(initialData.amount);
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    triggerHaptic("medium");

    const formData = new FormData();
    formData.append("accountId", accountId);
    formData.append("type", type);
    formData.append("amount", amount.trim());
    formData.append("date", date);
    if (description) formData.append("description", description.trim());
    if (symbol) formData.append("symbol", symbol.trim().toUpperCase());
    if (quantity) formData.append("quantity", quantity.trim());
    if (confirmRoth) formData.append("confirmRoth", "true");

    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.success("Transaction Logged", {
          description: `${type} of $${amount} recorded`,
        });
        onClose();
      } else {
        triggerHaptic("error");
        toast.error("Transaction Error", { description: res.error });
      }
    });
  }

  const isTrade = type === "BUY" || type === "SELL";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in-0">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TrendingUp className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">Log Transaction / Flow</h3>
              <p className="text-xs text-muted-foreground">Record trades, contributions, dividends, or cash flows</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Transaction Type Pill Selector */}
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">Transaction Type</label>
            <div className="flex flex-wrap gap-1.5">
              {TX_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    setType(t);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                    type === t
                      ? "bg-foreground text-background shadow-xs scale-102"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                Total Amount ({accountCurrency})
              </label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                placeholder="e.g. 1000.00"
                autoFocus
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm tabular-nums shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-foreground">Transaction Date</label>
                <button
                  type="button"
                  onClick={() => setDate(new Date().toISOString().slice(0, 10))}
                  className="text-[10px] text-primary hover:underline cursor-pointer"
                >
                  Today
                </button>
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Trade Auto-Sync Box */}
          <div className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
            isTrade ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/20"
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span>Holdings Auto-Sync</span>
                {isTrade ? (
                  <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                    Recommended for {type}
                  </Badge>
                ) : null}
              </span>
              <span className="text-[11px] text-muted-foreground">Auto-updates portfolio shares</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">Ticker Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. TSLA"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs font-mono uppercase"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">Shares / Units</label>
                <input
                  type="number"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 10"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs tabular-nums"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description / Notes (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Monthly automated contribution"
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs"
            />
          </div>

          {accountType === "ROTH_IRA" && type === "CONTRIBUTION" ? (
            <label className="flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/30 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmRoth}
                onChange={(e) => setConfirmRoth(e.target.checked)}
                className="mt-0.5"
              />
              <span>I understand a contribution while Canadian-resident may permanently taint the Roth treaty election.</span>
            </label>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending} className="min-w-[110px] gap-1.5">
              {isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              <span>{isPending ? "Recording..." : "Log Transaction"}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Balance Snapshot Modal
// ---------------------------------------------------------------------------
export function AddSnapshotModal({
  isOpen,
  onClose,
  accountId,
  accountCurrency,
  action,
}: {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  accountCurrency: string;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    triggerHaptic("medium");

    const formData = new FormData();
    formData.append("accountId", accountId);
    formData.append("balance", balance.trim());
    formData.append("asOf", asOf);

    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.success("Snapshot Recorded", {
          description: `Anchored balance of $${balance} ${accountCurrency}`,
        });
        onClose();
      } else {
        triggerHaptic("error");
        toast.error("Failed to record snapshot", { description: res.error });
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in-0">
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Calendar className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">Record Balance Snapshot</h3>
              <p className="text-xs text-muted-foreground">Anchor point-in-time statement balance</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">
              Statement Balance ({accountCurrency})
            </label>
            <input
              type="text"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              required
              placeholder="e.g. 5297.29"
              autoFocus
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm tabular-nums shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">As Of Date</label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              required
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending} className="min-w-[100px] gap-1.5">
              {isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Calendar className="size-3.5" />}
              <span>{isPending ? "Saving..." : "Save Snapshot"}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich Holdings List with P&L Badges, Weight %, and Inline Quick Actions
// ---------------------------------------------------------------------------
export interface HoldingViewItem {
  id: string;
  symbol: string;
  name: string;
  domicileCountry: string;
  quantity: number;
  lastPriceMinor: number;
  priceCurrency: string | null;
  priceAsOf: string;
  priceStatus: string | null;
  priceSource: string | null;
  bookCostMinor: number | null;
  convertedValueMinor: number;
  weightPercentage: number;
}

export function HoldingsList({
  holdings,
  currency,
  onAddHolding,
  onEditHolding,
  onQuickTrade,
  deleteHoldingAction,
}: {
  holdings: HoldingViewItem[];
  currency: Currency;
  onAddHolding: () => void;
  onEditHolding: (holding: HoldingViewItem) => void;
  onQuickTrade: (holding: HoldingViewItem, tradeType: "BUY" | "SELL") => void;
  deleteHoldingAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [deleteTarget, setDeleteTarget] = useState<HoldingViewItem | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    triggerHaptic("warning");
    const formData = new FormData();
    formData.append("holdingId", deleteTarget.id);

    startDeleteTransition(async () => {
      const res = await deleteHoldingAction(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.info(`Deleted ${deleteTarget.symbol} position`);
        setDeleteTarget(null);
      } else {
        triggerHaptic("error");
        toast.error("Failed to delete holding", { description: res.error });
      }
    });
  }

  if (holdings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/50">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
          <Layers className="size-5" />
        </div>
        <p className="text-sm font-semibold text-foreground">No holdings added yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Add your stock, ETF, or crypto positions to track valuations, cost basis, and automated price feeds.
        </p>
        <Button onClick={onAddHolding} size="sm" className="mt-4 gap-1.5">
          <Plus className="size-3.5" />
          <span>Add first position</span>
        </Button>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
        {holdings.map((h) => {
          const hasBookCost = h.bookCostMinor !== null && h.bookCostMinor > 0;
          const gainLossMinor = hasBookCost ? h.convertedValueMinor - h.bookCostMinor! : null;
          const gainLossPct = hasBookCost && h.bookCostMinor! > 0 ? (gainLossMinor! / h.bookCostMinor!) * 100 : null;
          const isPositive = gainLossMinor !== null && gainLossMinor >= 0;

          return (
            <li
              key={h.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 hover:bg-muted/30 transition-colors group"
            >
              {/* Left Column: Asset info, Domicile, Freshness, Weight */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <CopyTickerBadge symbol={h.symbol} />
                  <span className="font-semibold text-foreground text-sm">{h.name}</span>
                  <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                    {h.weightPercentage.toFixed(1)}% of acct
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span>{h.quantity} shares @</span>
                    <strong className="font-mono text-foreground font-medium">
                      {formatMinorUnits(h.lastPriceMinor, (h.priceCurrency || currency) as Currency)}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>{h.domicileCountry}</span>
                  <span>·</span>
                  <span>{h.priceAsOf.slice(0, 10)}</span>
                  {h.priceStatus === "STALE" ? (
                    <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400 border-amber-500/40 px-1 py-0">
                      Stale
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-emerald-700 dark:text-emerald-400 border-emerald-500/40 px-1 py-0">
                      Fresh
                    </Badge>
                  )}
                </div>
              </div>

              {/* Right Column: Value, P&L, Quick Action Buttons */}
              <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2.5 sm:pt-0 border-border/40">
                <div className="text-left sm:text-right">
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {formatMinorUnits(h.convertedValueMinor, currency)}
                  </p>
                  {hasBookCost ? (
                    <div className="flex items-center sm:justify-end gap-1 text-xs font-semibold tabular-nums">
                      <span className={isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                        {isPositive ? "+" : ""}
                        {formatMinorUnits(gainLossMinor!, currency)} ({isPositive ? "+" : ""}
                        {gainLossPct!.toFixed(1)}%)
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No cost basis recorded</span>
                  )}
                </div>

                {/* Action Buttons: Quick Buy, Quick Sell, Edit, Delete */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("light");
                      onQuickTrade(h, "BUY");
                    }}
                    title={`Log Buy trade for ${h.symbol}`}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer"
                  >
                    <Plus className="size-3 text-emerald-600" />
                    <span>Buy</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("light");
                      onQuickTrade(h, "SELL");
                    }}
                    title={`Log Sell trade for ${h.symbol}`}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer"
                  >
                    <Minus className="size-3 text-rose-600" />
                    <span>Sell</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("light");
                      onEditHolding(h);
                    }}
                    title={`Edit ${h.symbol} holding`}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95 cursor-pointer"
                  >
                    <Edit2 className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("warning");
                      setDeleteTarget(h);
                    }}
                    title={`Delete ${h.symbol} holding`}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors active:scale-95 cursor-pointer"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.symbol} Holding?`}
        description={`Are you sure you want to delete this position (${deleteTarget?.quantity} shares)? It will be removed from your portfolio value and calculations.`}
        onConfirm={handleDeleteConfirm}
        isPending={isDeleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Transactions List with Filter Chips & Safe Delete
// ---------------------------------------------------------------------------
export interface TransactionViewItem {
  id: string;
  type: string;
  amountMinor: number;
  currency: string;
  date: string;
  description: string | null;
}

export function TransactionsList({
  transactions,
  accountCurrency,
  onAddTransaction,
  deleteTransactionAction,
}: {
  transactions: TransactionViewItem[];
  accountCurrency: Currency;
  onAddTransaction: () => void;
  deleteTransactionAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [filter, setFilter] = useState<string>("ALL");
  const [deleteTarget, setDeleteTarget] = useState<TransactionViewItem | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const filtered = transactions.filter((t) => {
    if (filter === "ALL") return true;
    if (filter === "TRADES") return t.type === "BUY" || t.type === "SELL";
    if (filter === "FLOWS") return t.type === "CONTRIBUTION" || t.type === "WITHDRAWAL";
    if (filter === "INCOME") return t.type === "DIVIDEND" || t.type === "INTEREST";
    return t.type === filter;
  });

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    triggerHaptic("warning");
    const formData = new FormData();
    formData.append("transactionId", deleteTarget.id);

    startDeleteTransition(async () => {
      const res = await deleteTransactionAction(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.info("Deleted transaction");
        setDeleteTarget(null);
      } else {
        triggerHaptic("error");
        toast.error("Failed to delete transaction", { description: res.error });
      }
    });
  }

  function getTypeBadgeVariant(type: string) {
    if (type === "CONTRIBUTION" || type === "DIVIDEND" || type === "INTEREST") {
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    }
    if (type === "WITHDRAWAL" || type === "FEE") {
      return "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30";
    }
    if (type === "BUY") {
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30";
    }
    if (type === "SELL") {
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30";
    }
    return "bg-muted text-foreground";
  }

  return (
    <div className="space-y-3">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {["ALL", "TRADES", "FLOWS", "INCOME"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setFilter(f);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                filter === f
                  ? "bg-foreground text-background shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "record" : "records"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/50">
          <p className="text-xs text-muted-foreground">No transactions found matching filter.</p>
          <Button onClick={onAddTransaction} size="sm" variant="outline" className="mt-3 gap-1.5">
            <Plus className="size-3.5" />
            <span>Log a transaction</span>
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
          {filtered.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 p-3.5 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold shrink-0 ${getTypeBadgeVariant(t.type)}`}>
                  {t.type}
                </span>
                <span className="text-xs font-medium text-muted-foreground shrink-0">{t.date.slice(0, 10)}</span>
                {t.description ? (
                  <span className="text-xs text-foreground truncate max-w-[200px] sm:max-w-xs">
                    · {t.description}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatMinorUnits(t.amountMinor, (t.currency || accountCurrency) as Currency)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("warning");
                    setDeleteTarget(t);
                  }}
                  title="Delete transaction"
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors active:scale-90 cursor-pointer"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <DeleteConfirmationDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Transaction?"
        description={`Are you sure you want to delete this ${deleteTarget?.type} transaction of ${
          deleteTarget ? formatMinorUnits(deleteTarget.amountMinor, deleteTarget.currency as Currency) : ""
        }? External flow adjustments will be recalculated.`}
        onConfirm={handleDeleteConfirm}
        isPending={isDeleting}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snapshots List with Safe Delete
// ---------------------------------------------------------------------------
export interface SnapshotViewItem {
  id: string;
  balanceMinor: number;
  currency: string;
  asOf: string;
}

export function SnapshotsList({
  snapshots,
  accountCurrency,
  onAddSnapshot,
  deleteSnapshotAction,
}: {
  snapshots: SnapshotViewItem[];
  accountCurrency: Currency;
  onAddSnapshot: () => void;
  deleteSnapshotAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [deleteTarget, setDeleteTarget] = useState<SnapshotViewItem | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    triggerHaptic("warning");
    const formData = new FormData();
    formData.append("snapshotId", deleteTarget.id);

    startDeleteTransition(async () => {
      const res = await deleteSnapshotAction(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.info("Deleted snapshot");
        setDeleteTarget(null);
      } else {
        triggerHaptic("error");
        toast.error("Failed to delete snapshot", { description: res.error });
      }
    });
  }

  if (snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/50">
        <p className="text-xs text-muted-foreground">No point-in-time balance snapshots logged yet.</p>
        <Button onClick={onAddSnapshot} size="sm" variant="outline" className="mt-3 gap-1.5">
          <Calendar className="size-3.5" />
          <span>Record a snapshot</span>
        </Button>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
        {snapshots.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2">
              <Calendar className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">{s.asOf.slice(0, 10)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {formatMinorUnits(s.balanceMinor, (s.currency || accountCurrency) as Currency)}
              </span>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("warning");
                  setDeleteTarget(s);
                }}
                title="Delete snapshot"
                className="p-1 text-muted-foreground hover:text-destructive transition-colors active:scale-90 cursor-pointer"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <DeleteConfirmationDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Balance Snapshot?"
        description={`Delete statement snapshot of ${
          deleteTarget ? formatMinorUnits(deleteTarget.balanceMinor, deleteTarget.currency as Currency) : ""
        } on ${deleteTarget?.asOf.slice(0, 10)}?`}
        onConfirm={handleDeleteConfirm}
        isPending={isDeleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Account Settings Modal
// ---------------------------------------------------------------------------
const ACCOUNT_TYPES = ["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"] as const;

export function AccountSettingsModal({
  isOpen,
  onClose,
  account,
  action,
  onDeleteAccount,
}: {
  isOpen: boolean;
  onClose: () => void;
  account: {
    id: string;
    name: string;
    institution: string;
    type: string;
    country: string;
    currency: string;
    isUSSitus: boolean;
  };
  action: (formData: FormData) => Promise<ActionResult>;
  onDeleteAccount: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(account.name);
  const [institution, setInstitution] = useState(account.institution);
  const [type, setType] = useState(account.type);
  const [country, setCountry] = useState(account.country);
  const [isUSSitus, setIsUSSitus] = useState(account.isUSSitus);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    triggerHaptic("medium");

    const formData = new FormData();
    formData.append("accountId", account.id);
    formData.append("name", name.trim());
    formData.append("institution", institution.trim());
    formData.append("type", type);
    formData.append("country", country.trim().toUpperCase());
    formData.append("currency", account.currency);
    if (isUSSitus) formData.append("isUSSitus", "true");

    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.success("Account Settings Saved");
        onClose();
      } else {
        triggerHaptic("error");
        toast.error("Failed to update settings", { description: res.error });
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in-0">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings2 className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">Account Settings</h3>
              <p className="text-xs text-muted-foreground">Update configuration and classification</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 mt-4 text-xs">
          <div>
            <label className="font-medium text-foreground block mb-1">Account Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs"
            />
          </div>

          <div>
            <label className="font-medium text-foreground block mb-1">Institution</label>
            <input
              type="text"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              required
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-medium text-foreground block mb-1">Account Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-xs"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-medium text-foreground block mb-1">Country (2-letter)</label>
              <input
                type="text"
                maxLength={2}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                required
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-xs font-mono uppercase"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-input bg-muted/20 p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isUSSitus}
              onChange={(e) => setIsUSSitus(e.target.checked)}
              className="rounded"
            />
            <span className="font-medium text-foreground">US-Situs Account (US Estate Tax Tracking)</span>
          </label>

          <div className="flex items-center justify-between pt-3 border-t border-border/60">
            <button
              type="button"
              onClick={() => {
                onClose();
                onDeleteAccount();
              }}
              className="text-xs font-medium text-destructive hover:underline cursor-pointer"
            >
              Delete account...
            </button>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending} className="min-w-[80px]">
                {isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Tab Navigation Component
// ---------------------------------------------------------------------------
export function AccountTabNav({
  activeTab,
  onTabChange,
  holdingsCount,
  transactionsCount,
  snapshotsCount,
}: {
  activeTab: "holdings" | "transactions" | "snapshots" | "details";
  onTabChange: (tab: "holdings" | "transactions" | "snapshots" | "details") => void;
  holdingsCount: number;
  transactionsCount: number;
  snapshotsCount: number;
}) {
  return (
    <div className="sticky top-14 z-20 flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border/80 bg-background/90 p-1.5 backdrop-blur-md shadow-xs">
      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          onTabChange("holdings");
        }}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
          activeTab === "holdings" ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
        }`}
      >
        <span>Holdings</span>
        <Badge
          variant={activeTab === "holdings" ? "secondary" : "outline"}
          className="px-1.5 py-0 text-[10px] font-mono"
        >
          {holdingsCount}
        </Badge>
      </button>

      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          onTabChange("transactions");
        }}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
          activeTab === "transactions" ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
        }`}
      >
        <span>Activity & Flows</span>
        <Badge
          variant={activeTab === "transactions" ? "secondary" : "outline"}
          className="px-1.5 py-0 text-[10px] font-mono"
        >
          {transactionsCount}
        </Badge>
      </button>

      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          onTabChange("snapshots");
        }}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
          activeTab === "snapshots" ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
        }`}
      >
        <span>Snapshots</span>
        <Badge
          variant={activeTab === "snapshots" ? "secondary" : "outline"}
          className="px-1.5 py-0 text-[10px] font-mono"
        >
          {snapshotsCount}
        </Badge>
      </button>

      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          onTabChange("details");
        }}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
          activeTab === "details" ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
        }`}
      >
        <Settings2 className="size-3.5" />
        <span>Settings</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Detail Main Interactive Controller
// ---------------------------------------------------------------------------
export function AccountDetailInteractiveView({
  account,
  currency,
  holdings,
  transactions,
  snapshots,
  actions,
}: {
  account: {
    id: string;
    name: string;
    institution: string;
    type: string;
    country: string;
    currency: string;
    isUSSitus: boolean;
  };
  currency: Currency;
  holdings: HoldingViewItem[];
  transactions: TransactionViewItem[];
  snapshots: SnapshotViewItem[];
  cashMinor: number;
  totalValueMinor: number;
  totalBookCostMinor: number;
  totalGainLossMinor: number | null;
  allocationHoldings: AllocationItem[];
  actions: {
    addHolding: (formData: FormData) => Promise<ActionResult>;
    deleteHolding: (formData: FormData) => Promise<ActionResult>;
    addTransaction: (formData: FormData) => Promise<ActionResult>;
    updateTransaction: (formData: FormData) => Promise<ActionResult>;
    deleteTransaction: (formData: FormData) => Promise<ActionResult>;
    addSnapshot: (formData: FormData) => Promise<ActionResult>;
    deleteSnapshot: (formData: FormData) => Promise<ActionResult>;
    setCashBalance: (formData: FormData) => Promise<ActionResult>;
    updateAccount: (formData: FormData) => Promise<ActionResult>;
    deleteAccount: (formData: FormData) => Promise<ActionResult>;
  };
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"holdings" | "transactions" | "snapshots" | "details">("holdings");
  const [isAddHoldingOpen, setIsAddHoldingOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<HoldingFormData | null>(null);
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [initialTradeData, setInitialTradeData] = useState<{
    type?: string;
    symbol?: string;
    quantity?: number;
    amount?: string;
  } | null>(null);
  const [isAddSnapshotOpen, setIsAddSnapshotOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isDeletingAccount, startDeleteAccountTransition] = useTransition();

  function handleOpenAddHolding() {
    triggerHaptic("light");
    setEditingHolding(null);
    setIsAddHoldingOpen(true);
  }

  function handleEditHolding(h: HoldingViewItem) {
    triggerHaptic("light");
    setEditingHolding({
      symbol: h.symbol,
      quantity: String(h.quantity),
      bookCost: h.bookCostMinor ? minorToDollarInput(h.bookCostMinor) : "",
      name: h.name,
      domicileCountry: h.domicileCountry,
      lastPrice: h.lastPriceMinor ? minorToDollarInput(h.lastPriceMinor) : "",
      priceAsOf: h.priceAsOf.slice(0, 10),
    });
    setIsAddHoldingOpen(true);
  }

  function handleQuickTrade(h: HoldingViewItem, tradeType: "BUY" | "SELL") {
    triggerHaptic("light");
    setInitialTradeData({
      type: tradeType,
      symbol: h.symbol,
      quantity: tradeType === "SELL" ? h.quantity : undefined,
      amount: h.lastPriceMinor ? minorToDollarInput(h.lastPriceMinor) : undefined,
    });
    setIsAddTransactionOpen(true);
  }

  function handleOpenAddTransaction() {
    triggerHaptic("light");
    setInitialTradeData(null);
    setIsAddTransactionOpen(true);
  }

  function handleOpenAddSnapshot() {
    triggerHaptic("light");
    setIsAddSnapshotOpen(true);
  }

  function handleDeleteAccountConfirm() {
    triggerHaptic("warning");
    const formData = new FormData();
    formData.append("id", account.id);

    startDeleteAccountTransition(async () => {
      const res = await actions.deleteAccount(formData);
      if (res.ok) {
        triggerHaptic("success");
        toast.info("Account deleted");
        router.push("/investments");
      } else {
        triggerHaptic("error");
        toast.error("Failed to delete account", { description: res.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <AccountTabNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === "details") {
            setIsSettingsOpen(true);
          } else {
            setActiveTab(tab);
          }
        }}
        holdingsCount={holdings.length}
        transactionsCount={transactions.length}
        snapshotsCount={snapshots.length}
      />

      {/* Main Content Area Based on Active Tab */}
      {activeTab === "holdings" && (
        <section className="space-y-4 animate-in fade-in-50 duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Holdings & Positions</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Current asset quantities, market prices, and returns
              </p>
            </div>
            <Button onClick={handleOpenAddHolding} size="sm" className="gap-1.5 shadow-xs cursor-pointer">
              <Plus className="size-3.5" />
              <span>Add Position</span>
            </Button>
          </div>

          <HoldingsList
            holdings={holdings}
            currency={currency}
            onAddHolding={handleOpenAddHolding}
            onEditHolding={handleEditHolding}
            onQuickTrade={handleQuickTrade}
            deleteHoldingAction={actions.deleteHolding}
          />
        </section>
      )}

      {activeTab === "transactions" && (
        <section className="space-y-4 animate-in fade-in-50 duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Activity & Cash Flows</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Record of trades, external contributions, and distributions
              </p>
            </div>
            <Button onClick={handleOpenAddTransaction} size="sm" className="gap-1.5 shadow-xs cursor-pointer">
              <Plus className="size-3.5" />
              <span>Log Transaction</span>
            </Button>
          </div>

          <TransactionsList
            transactions={transactions}
            accountCurrency={currency}
            onAddTransaction={handleOpenAddTransaction}
            deleteTransactionAction={actions.deleteTransaction}
          />
        </section>
      )}

      {activeTab === "snapshots" && (
        <section className="space-y-4 animate-in fade-in-50 duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Balance Snapshots</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Point-in-time statements used to anchor net worth calculations
              </p>
            </div>
            <Button onClick={handleOpenAddSnapshot} size="sm" className="gap-1.5 shadow-xs cursor-pointer">
              <Calendar className="size-3.5" />
              <span>New Snapshot</span>
            </Button>
          </div>

          <SnapshotsList
            snapshots={snapshots}
            accountCurrency={currency}
            onAddSnapshot={handleOpenAddSnapshot}
            deleteSnapshotAction={actions.deleteSnapshot}
          />
        </section>
      )}

      {/* Modals & Dialogs */}
      <AddHoldingModal
        isOpen={isAddHoldingOpen}
        onClose={() => setIsAddHoldingOpen(false)}
        accountId={account.id}
        accountCountry={account.country}
        accountCurrency={currency}
        action={actions.addHolding}
        initialData={editingHolding}
      />

      <AddTransactionModal
        isOpen={isAddTransactionOpen}
        onClose={() => setIsAddTransactionOpen(false)}
        accountId={account.id}
        accountCurrency={currency}
        accountType={account.type}
        action={actions.addTransaction}
        initialData={initialTradeData}
      />

      <AddSnapshotModal
        isOpen={isAddSnapshotOpen}
        onClose={() => setIsAddSnapshotOpen(false)}
        accountId={account.id}
        accountCurrency={currency}
        action={actions.addSnapshot}
      />

      <AccountSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        account={account}
        action={actions.updateAccount}
        onDeleteAccount={() => setIsDeleteAccountOpen(true)}
      />

      <DeleteConfirmationDialog
        isOpen={isDeleteAccountOpen}
        onClose={() => setIsDeleteAccountOpen(false)}
        title={`Delete "${account.name}" Account?`}
        description="This will permanently delete this account and all its holdings, transactions, and snapshots. This action cannot be undone."
        onConfirm={handleDeleteAccountConfirm}
        isPending={isDeletingAccount}
      />
    </div>
  );
}
