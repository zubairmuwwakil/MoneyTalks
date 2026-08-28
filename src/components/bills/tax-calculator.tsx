"use client";

import { useState } from "react";
import { Calculator, Check, Percent, RotateCcw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TaxPreset {
  id: string;
  name: string;
  shortLabel: string;
  ratePct: number;
  description: string;
}

export const CANADIAN_TAX_PRESETS: TaxPreset[] = [
  { id: "on", name: "Ontario", shortLabel: "ON 13% HST", ratePct: 13, description: "13% HST" },
  { id: "bc", name: "British Columbia", shortLabel: "BC 12%", ratePct: 12, description: "5% GST + 7% PST" },
  { id: "qc", name: "Quebec", shortLabel: "QC 14.975%", ratePct: 14.975, description: "5% GST + 9.975% QST" },
  { id: "ab", name: "Alberta / Federal GST", shortLabel: "AB/GST 5%", ratePct: 5, description: "5% GST (AB, YT, NT, NU)" },
  { id: "atl", name: "Atlantic Canada", shortLabel: "Atlantic 15%", ratePct: 15, description: "15% HST (NB, NL, NS, PE)" },
  { id: "sk", name: "Saskatchewan", shortLabel: "SK 11%", ratePct: 11, description: "5% GST + 6% PST" },
  { id: "mb", name: "Manitoba", shortLabel: "MB 12%", ratePct: 12, description: "5% GST + 7% PST" },
];

export interface TaxCalculationResult {
  baseAmount: number;
  taxRatePct: number;
  taxAmount: number;
  totalAmount: number;
  mode: "add_tax" | "extract_tax";
}

/**
 * Calculates tax addition (Base -> Total) or extraction (Total -> Base + Tax).
 * Uses standard 2-decimal rounding.
 */
export function calculateTax({
  amount,
  ratePct,
  mode,
}: {
  amount: number;
  ratePct: number;
  mode: "add_tax" | "extract_tax";
}): TaxCalculationResult {
  if (isNaN(amount) || amount <= 0 || isNaN(ratePct) || ratePct < 0) {
    return {
      baseAmount: 0,
      taxRatePct: ratePct || 0,
      taxAmount: 0,
      totalAmount: 0,
      mode,
    };
  }

  const rate = ratePct / 100;

  if (mode === "add_tax") {
    const baseAmount = Math.round(amount * 100) / 100;
    const taxAmount = Math.round(baseAmount * rate * 100) / 100;
    const totalAmount = Math.round((baseAmount + taxAmount) * 100) / 100;
    return {
      baseAmount,
      taxRatePct: ratePct,
      taxAmount,
      totalAmount,
      mode,
    };
  } else {
    // extract_tax: amount is Total
    const totalAmount = Math.round(amount * 100) / 100;
    const baseAmount = Math.round((totalAmount / (1 + rate)) * 100) / 100;
    const taxAmount = Math.round((totalAmount - baseAmount) * 100) / 100;
    return {
      baseAmount,
      taxRatePct: ratePct,
      taxAmount,
      totalAmount,
      mode,
    };
  }
}

interface TaxCalculatorProps {
  currentAmount: string;
  currency?: string;
  onApplyAmount: (newAmount: string, calculationNote?: string) => void;
  className?: string;
}

export function TaxCalculator({
  currentAmount,
  currency = "CAD",
  onApplyAmount,
  className = "",
}: TaxCalculatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputVal, setInputVal] = useState<string>(currentAmount || "");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("on");
  const [customRate, setCustomRate] = useState<string>("13");
  const [mode, setMode] = useState<"add_tax" | "extract_tax">("add_tax");
  const [appliedNotification, setAppliedNotification] = useState<string | null>(null);

  const activeInputNumber = parseFloat(inputVal || currentAmount || "0");
  const activeRatePct =
    selectedPresetId === "custom"
      ? parseFloat(customRate || "0")
      : (CANADIAN_TAX_PRESETS.find((p) => p.id === selectedPresetId)?.ratePct ?? 13);

  const result = calculateTax({
    amount: activeInputNumber,
    ratePct: activeRatePct,
    mode,
  });

  const handleApply = () => {
    const finalAmountStr = result.totalAmount.toFixed(2);

    const presetName =
      selectedPresetId === "custom"
        ? `${activeRatePct}% Tax`
        : CANADIAN_TAX_PRESETS.find((p) => p.id === selectedPresetId)?.shortLabel;

    const note =
      mode === "add_tax"
        ? `Base: $${result.baseAmount.toFixed(2)} + ${presetName} ($${result.taxAmount.toFixed(2)})`
        : `Total: $${result.totalAmount.toFixed(2)} (Includes ${presetName} of $${result.taxAmount.toFixed(2)}, Base: $${result.baseAmount.toFixed(2)})`;

    onApplyAmount(finalAmountStr, note);
    setAppliedNotification(`Applied $${finalAmountStr}`);
    setTimeout(() => setAppliedNotification(null), 2500);
  };

  const handleQuickPreset = (preset: TaxPreset) => {
    setSelectedPresetId(preset.id);
    const numericCurrent = parseFloat(currentAmount || inputVal || "0");
    if (numericCurrent > 0) {
      const quickRes = calculateTax({
        amount: numericCurrent,
        ratePct: preset.ratePct,
        mode: "add_tax",
      });
      const finalStr = quickRes.totalAmount.toFixed(2);
      onApplyAmount(
        finalStr,
        `Base: $${quickRes.baseAmount.toFixed(2)} + ${preset.shortLabel} ($${quickRes.taxAmount.toFixed(2)})`
      );
      setAppliedNotification(`Applied ${preset.shortLabel} → $${finalStr}`);
      setTimeout(() => setAppliedNotification(null), 2500);
    } else {
      setIsOpen(true);
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Quick Access Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-medium text-muted-foreground mr-0.5 flex items-center gap-1">
            <Sparkles className="size-3 text-amber-500" />
            Quick Tax:
          </span>
          {CANADIAN_TAX_PRESETS.slice(0, 4).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleQuickPreset(preset)}
              className="inline-flex items-center rounded-md border border-border/80 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent hover:border-accent-foreground/20 hover:text-accent-foreground transition-all cursor-pointer shadow-2xs"
              title={`Calculate ${preset.description} on current amount`}
            >
              +{preset.ratePct}% {preset.id.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            if (!isOpen && currentAmount && !inputVal) {
              setInputVal(currentAmount);
            }
            setIsOpen(!isOpen);
          }}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer"
        >
          <Calculator className="size-3" />
          <span>{isOpen ? "Close calculator" : "Calculate tax"}</span>
          {isOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>

      {appliedNotification ? (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/30 rounded-md px-2.5 py-1 animate-fadeIn">
          <Check className="size-3 shrink-0" />
          <span>{appliedNotification}</span>
        </div>
      ) : null}

      {/* Expanded Interactive Calculator Panel */}
      {isOpen ? (
        <div className="rounded-xl border border-primary/20 bg-card p-3.5 shadow-sm space-y-3.5 mt-2 animate-fadeIn transition-all">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <div className="flex items-center gap-1.5">
              <Calculator className="size-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Sales Tax Assistant</span>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode("add_tax")}
                className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                  mode === "add_tax"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Add Tax (Base → Total)
              </button>
              <button
                type="button"
                onClick={() => setMode("extract_tax")}
                className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                  mode === "extract_tax"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Extract Tax (Total → Base)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Amount input */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                {mode === "add_tax" ? "Pre-Tax Base Amount ($)" : "Receipt / Total Amount ($)"}
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-xs text-muted-foreground font-semibold">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder={currentAmount || "e.g. 87.57"}
                  className="flex h-8 w-full rounded-md border border-input bg-background pl-6 pr-2 py-1 text-xs shadow-2xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            {/* Tax Rate Selection */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Province / Tax Region
              </label>
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-2xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {CANADIAN_TAX_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.description}
                  </option>
                ))}
                <option value="custom">Custom Percentage (%)</option>
              </select>
            </div>
          </div>

          {selectedPresetId === "custom" ? (
            <div className="pt-1">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Custom Tax Rate (%)
              </label>
              <div className="relative max-w-32">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="100"
                  value={customRate}
                  onChange={(e) => setCustomRate(e.target.value)}
                  placeholder="e.g. 13"
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-2xs pr-6"
                />
                <Percent className="absolute right-2 top-2 size-3 text-muted-foreground" />
              </div>
            </div>
          ) : null}

          {/* Breakdown HUD Card */}
          {activeInputNumber > 0 ? (
            <div className="rounded-lg border border-border/80 bg-muted/30 p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{mode === "add_tax" ? "Base (Pre-tax):" : "Calculated Base:"}</span>
                <span className="font-mono font-medium text-foreground">
                  ${result.baseAmount.toFixed(2)} {currency}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Tax ({activeRatePct}%):</span>
                <span className="font-mono font-medium text-foreground">
                  +${result.taxAmount.toFixed(2)} {currency}
                </span>
              </div>
              <div className="border-t border-border/60 pt-1 flex items-center justify-between font-semibold text-foreground">
                <span>{mode === "add_tax" ? "Total With Tax:" : "Total (Entered):"}</span>
                <span className="font-mono text-sm text-primary">
                  ${result.totalAmount.toFixed(2)} {currency}
                </span>
              </div>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setInputVal("");
                setSelectedPresetId("on");
                setMode("add_tax");
              }}
              className="text-muted-foreground hover:text-foreground text-[11px] gap-1"
            >
              <RotateCcw className="size-3" />
              Reset
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setIsOpen(false)}
                className="text-[11px]"
              >
                Done
              </Button>
              <Button
                type="button"
                size="xs"
                disabled={activeInputNumber <= 0}
                onClick={handleApply}
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-[11px] gap-1 shadow-xs"
              >
                <Check className="size-3" />
                Apply ${result.totalAmount.toFixed(2)}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
