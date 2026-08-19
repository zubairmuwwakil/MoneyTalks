"use client";

import { useState, useMemo } from "react";
import { CARD_PRESETS, type CardPreset } from "@/lib/cards/presets";
import type { CardFormValues } from "@/components/card-form";
import { Search, Sparkles, Check, RotateCcw, X, PlusCircle } from "lucide-react";

interface CardPresetSelectorProps {
  currentValues: CardFormValues;
  onSelectPreset: (preset: CardPreset) => void;
  onResetToBlank: () => void;
}

type FilterType = "all" | "AMEX" | "VISA" | "MASTERCARD" | "no-fee";

export function CardPresetSelector({
  currentValues,
  onSelectPreset,
  onResetToBlank,
}: CardPresetSelectorProps) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [isOpen, setIsOpen] = useState(true);

  // Match currently active preset if any
  const activePreset = useMemo(() => {
    return CARD_PRESETS.find(
      (p) =>
        p.values.nickname.toLowerCase() === currentValues.nickname.toLowerCase() ||
        p.name.toLowerCase() === currentValues.nickname.toLowerCase()
    );
  }, [currentValues.nickname]);

  const counts = useMemo(() => {
    return {
      all: CARD_PRESETS.length,
      AMEX: CARD_PRESETS.filter((p) => p.network === "AMEX").length,
      VISA: CARD_PRESETS.filter((p) => p.network === "VISA").length,
      MASTERCARD: CARD_PRESETS.filter((p) => p.network === "MASTERCARD").length,
      "no-fee": CARD_PRESETS.filter((p) => p.annualFee === 0).length,
    };
  }, []);

  const filteredPresets = useMemo(() => {
    return CARD_PRESETS.filter((preset) => {
      // Filter tab
      if (activeFilter === "AMEX" && preset.network !== "AMEX") return false;
      if (activeFilter === "VISA" && preset.network !== "VISA") return false;
      if (activeFilter === "MASTERCARD" && preset.network !== "MASTERCARD") return false;
      if (activeFilter === "no-fee" && preset.annualFee > 0) return false;

      // Query search
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      const matchName = preset.name.toLowerCase().includes(q);
      const matchIssuer = preset.issuer.toLowerCase().includes(q);
      const matchHighlights = preset.highlights.some((h) => h.toLowerCase().includes(q));
      const matchProgram = preset.programName?.toLowerCase().includes(q);
      return matchName || matchIssuer || matchHighlights || matchProgram;
    });
  }, [query, activeFilter]);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 shadow-2xs space-y-4">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-semibold tracking-tight text-foreground">
              Autofill from Card Presets ({CARD_PRESETS.length} Canadian Cards Available)
            </h2>
            <p className="text-xs text-muted-foreground">
              Select any card from the verified catalogue to populate multipliers, spend caps, FX rates, and annual fees in 1 click.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {activePreset && (
            <button
              type="button"
              onClick={onResetToBlank}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors px-2 py-1 rounded-md hover:bg-muted/50"
            >
              <RotateCcw className="size-3" />
              <span>Reset to blank</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            {isOpen ? "Collapse presets" : `Show presets (${CARD_PRESETS.length})`}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-3 pt-1">
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search all 27 cards by name, issuer (e.g. Cobalt, Scotia, Rogers, TD, RBC, CIBC, BMO, National Bank)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-8 text-xs shadow-2xs placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: "all", label: `All (${counts.all})` },
                  { id: "AMEX", label: `Amex (${counts.AMEX})` },
                  { id: "VISA", label: `Visa (${counts.VISA})` },
                  { id: "MASTERCARD", label: `Mastercard (${counts.MASTERCARD})` },
                  { id: "no-fee", label: `$0 Fee (${counts["no-fee"]})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeFilter === tab.id
                      ? "bg-foreground text-background shadow-2xs"
                      : "bg-background text-muted-foreground hover:text-foreground border border-border/70 hover:bg-muted/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Presets Grid */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-80 overflow-y-auto pr-1">
            {filteredPresets.map((preset) => {
              const isSelected = activePreset?.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectPreset(preset)}
                  className={`group relative flex flex-col justify-between text-left rounded-lg p-3 border transition-all cursor-pointer ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary"
                      : "border-border/80 bg-background hover:border-primary/50 hover:bg-muted/30"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground line-clamp-1">
                          {preset.issuer}
                        </p>
                        <h4 className="text-xs font-bold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                          {preset.name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border border-border/60">
                          {preset.network}
                        </span>
                        {isSelected && (
                          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-2.5" />
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                      {preset.highlights.join(" • ")}
                    </p>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-border/50 text-[10px]">
                    <span className="font-semibold text-foreground">
                      {preset.annualFee === 0 ? "No annual fee" : `$${preset.annualFee.toFixed(2)}/yr`}
                    </span>
                    <span className="font-medium text-primary group-hover:underline flex items-center gap-0.5">
                      {isSelected ? "Active preset" : "Use preset →"}
                    </span>
                  </div>
                </button>
              );
            })}

            {/* Custom Blank Option Card */}
            <button
              type="button"
              onClick={onResetToBlank}
              className="flex flex-col items-center justify-center text-center rounded-lg p-3 border border-dashed border-border/90 bg-background/50 hover:border-primary/50 hover:bg-muted/20 transition-all cursor-pointer min-h-[96px]"
            >
              <PlusCircle className="size-5 text-muted-foreground mb-1" />
              <span className="text-xs font-semibold text-foreground">Custom / Blank Card</span>
              <span className="text-[10px] text-muted-foreground">Configure from scratch</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
