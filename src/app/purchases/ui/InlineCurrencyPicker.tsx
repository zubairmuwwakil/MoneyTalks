"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Check,
  ChevronDown,
  Coins,
  Globe,
  Loader2,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setPurchaseCurrency } from "../[id]/actions";
import { formatMoney } from "@/lib/utils/calendarEvents";

const POPULAR_CURRENCIES = [
  { code: "CAD", symbol: "$", flag: "🇨🇦", label: "Canadian Dollar" },
  { code: "USD", symbol: "$", flag: "🇺🇸", label: "US Dollar" },
  { code: "EUR", symbol: "€", flag: "🇪🇺", label: "Euro" },
  { code: "GBP", symbol: "£", flag: "🇬🇧", label: "British Pound" },
  { code: "XCD", symbol: "EC$", flag: "🌴", label: "East Caribbean Dollar" },
  { code: "AUD", symbol: "A$", flag: "🇦🇺", label: "Australian Dollar" },
  { code: "JPY", symbol: "¥", flag: "🇯🇵", label: "Japanese Yen" },
  { code: "MXN", symbol: "$", flag: "🇲🇽", label: "Mexican Peso" },
] as const;

export interface InlineCurrencyPickerProps {
  purchaseId: string;
  merchant: string;
  currentCurrency?: string | null;
  currencySource?: string | null;
  totalCents?: number | null;
  variant?: "amount-row" | "badge" | "compact" | "triage-chip";
  onCurrencyChange?: (newCurrency: string) => void;
}

export function InlineCurrencyPicker({
  purchaseId,
  merchant,
  currentCurrency,
  currencySource,
  totalCents,
  variant = "amount-row",
  onCurrencyChange,
}: InlineCurrencyPickerProps) {
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<string | null>(currentCurrency ?? null);
  const [customCode, setCustomCode] = useState("");
  const [rememberForMerchant, setRememberForMerchant] = useState(true);
  const [isPending, startTransition] = useTransition();

  const isUnknown = !currency;

  function handleSelect(code: string) {
    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cleanCode)) {
      toast.error("Please enter a valid 3-letter currency code (e.g. CAD, USD)");
      return;
    }

    startTransition(async () => {
      // Optimistic update
      setCurrency(cleanCode);
      setOpen(false);
      onCurrencyChange?.(cleanCode);

      try {
        const result = await setPurchaseCurrency({
          purchaseId,
          currency: cleanCode,
          rememberForMerchant,
        });

        if (result && !result.ok) {
          setCurrency(currentCurrency ?? null);
          toast.error(result.error ?? "Failed to update currency");
        } else {
          toast.success(
            rememberForMerchant && (result?.affectedPurchases ?? 1) > 1
              ? `Set to ${cleanCode} for ${merchant} (${result?.affectedPurchases} purchases updated)`
              : `Currency set to ${cleanCode}`
          );
        }
      } catch {
        setCurrency(currentCurrency ?? null);
        toast.error("Network error updating currency");
      }
    });
  }

  function renderDialog() {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-150" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <Dialog.Popup
              initialFocus
              className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border/80 bg-popover shadow-2xl outline-none animate-in slide-in-from-bottom-2 duration-200 sm:rounded-2xl sm:zoom-in-95"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Coins className="size-4" />
                    </div>
                    <Dialog.Title className="text-base font-semibold text-foreground">
                      Set Transaction Currency
                    </Dialog.Title>
                  </div>
                  <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                    For <span className="font-medium text-foreground">{merchant}</span>
                    {totalCents != null ? ` · ${(totalCents / 100).toFixed(2)}` : ""}
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  disabled={isPending}
                  aria-label="Close currency picker"
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-4" />
                </Dialog.Close>
              </div>

              {/* Body */}
              <div className="space-y-4 overflow-y-auto p-5">
                {/* Popular Currencies Grid */}
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Popular Currencies
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {POPULAR_CURRENCIES.map((curr) => {
                      const isSelected = currency === curr.code;
                      return (
                        <button
                          key={curr.code}
                          type="button"
                          disabled={isPending}
                          onClick={() => handleSelect(curr.code)}
                          className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                            isSelected
                              ? "border-primary bg-primary/10 text-foreground ring-2 ring-primary/20 shadow-xs"
                              : "border-border/80 bg-card hover:border-border hover:bg-muted/50 text-foreground shadow-2xs"
                          }`}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-base">{curr.flag}</span>
                            {isSelected ? <Check className="size-3.5 text-primary" /> : null}
                          </div>
                          <span className="mt-1 font-bold text-sm">{curr.code}</span>
                          <span className="text-[10px] text-muted-foreground truncate w-full">
                            {curr.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Currency Search / Input */}
                <div className="space-y-1.5 pt-1 border-t border-border/60">
                  <label htmlFor="custom-currency-input" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Custom Currency (ISO Code)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="custom-currency-input"
                      type="text"
                      maxLength={3}
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                      placeholder="e.g. CHF, INR, NZD"
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm uppercase text-foreground shadow-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 font-mono"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customCode.trim()) {
                          e.preventDefault();
                          handleSelect(customCode);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={isPending || customCode.trim().length !== 3}
                      onClick={() => handleSelect(customCode)}
                      className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                {/* Remember for Merchant Switch */}
                <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
                  <label className="flex cursor-pointer items-start gap-3 select-none">
                    <input
                      type="checkbox"
                      checked={rememberForMerchant}
                      onChange={(e) => setRememberForMerchant(e.target.checked)}
                      className="mt-0.5 size-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
                    />
                    <div className="text-xs">
                      <p className="font-semibold text-foreground">
                        Remember for {merchant}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Applies to all past unassigned purchases and future syncs from this merchant.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  // Triage Chip variant: Ultra-fast 1-tap CAD/USD buttons directly in queue
  if (variant === "triage-chip") {
    return (
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={() => handleSelect("CAD")}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/80 bg-background px-2 py-0.5 text-xs font-semibold text-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:opacity-50 shadow-2xs"
          title={`Set ${merchant} currency to CAD and remember`}
        >
          <span>🇨🇦 CAD</span>
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => handleSelect("USD")}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/80 bg-background px-2 py-0.5 text-xs font-semibold text-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:opacity-50 shadow-2xs"
          title={`Set ${merchant} currency to USD and remember`}
        >
          <span>🇺🇸 USD</span>
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setOpen(true)}
          className="inline-flex cursor-pointer items-center justify-center rounded-md border border-border/60 bg-muted/40 p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="More currency options"
          title="More currencies…"
        >
          <ChevronDown className="size-3" />
        </button>
        {renderDialog()}
      </div>
    );
  }

  // Amount row display in purchases list
  if (variant === "amount-row") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {totalCents != null ? (
            <span className="text-base font-bold text-foreground sm:text-lg tabular-nums">
              {currency ? formatMoney(totalCents, currency) : (totalCents / 100).toFixed(2)}
            </span>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">Pending</span>
          )}

          {isUnknown ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 transition-all hover:bg-amber-500/20 hover:scale-105 dark:text-amber-300 animate-pulse shadow-2xs"
              title="Currency unknown. Click to set currency in 1 tap."
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin text-amber-500" />
              ) : (
                <Coins className="size-3 text-amber-500" />
              )}
              <span>Set currency</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
              title={`Denominated in ${currency} (${currencySource ?? "set"}). Click to change.`}
            >
              <span>{currency}</span>
              <ChevronDown className="size-2.5 opacity-60" />
            </button>
          )}
        </div>
        {renderDialog()}
      </div>
    );
  }

  // Badge or compact variant
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          isUnknown
            ? "inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300 shadow-2xs transition"
            : "inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/80 bg-background/80 px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted transition"
        }
        title={isUnknown ? "Set currency" : `Currency: ${currency}. Click to change.`}
      >
        {isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : isUnknown ? (
          <Coins className="size-3 text-amber-500" />
        ) : (
          <Globe className="size-3 text-primary" />
        )}
        <span>{currency ?? "Currency unknown"}</span>
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {renderDialog()}
    </>
  );
}
