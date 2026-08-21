"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Search, ChevronDown, X, CreditCard, Sparkles } from "lucide-react";
import type { CatalogueChoice } from "@/lib/cards/catalogueCard";
import { POPULAR_CARD_IDS } from "@/lib/cards/catalogueCard";
import { CardImage } from "./card-image";

interface CardPickerProps {
  choices: CatalogueChoice[];
  value: string;
  onChange: (contractCardId: string) => void;
  showPopularChips?: boolean;
}

/**
 * High-ROI, searchable card picker.
 * Features:
 * - 1-Click Popular Card Chips (Cobalt, Scotia Gold, TD Aeroplan, Rogers World Elite, etc.)
 * - Issuer Filter Tabs (All, Amex, Scotiabank, TD, RBC, CIBC, BMO, etc.)
 * - Card Art Thumbnails in search results
 * - Full keyboard navigation (Arrow Up/Down, Enter, Esc)
 */
export function CardPicker({ choices, value, onChange, showPopularChips = true }: CardPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIssuer, setSelectedIssuer] = useState<string>("ALL");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = choices.find((c) => c.contractCardId === value) ?? null;

  // Extract unique issuers for filter tabs
  const issuers = useMemo(() => {
    const set = new Set<string>();
    choices.forEach((c) => set.add(c.issuer));
    return ["ALL", ...Array.from(set).sort()];
  }, [choices]);

  // Filter choices by query and active issuer tab
  const filtered = useMemo(() => {
    let result = choices;

    if (selectedIssuer !== "ALL") {
      result = result.filter((c) => c.issuer === selectedIssuer);
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (c) => c.officialName.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q),
      );
    }

    return result;
  }, [choices, query, selectedIssuer]);

  // Group filtered choices by issuer
  const grouped = useMemo(() => {
    const groups = new Map<string, CatalogueChoice[]>();
    for (const choice of filtered) {
      const bucket = groups.get(choice.issuer);
      if (bucket) bucket.push(choice);
      else groups.set(choice.issuer, [choice]);
    }
    return [...groups.entries()];
  }, [filtered]);

  // Flatten for keyboard navigation
  const flatItems = useMemo(() => filtered, [filtered]);

  // Popular cards list
  const popularChoices = useMemo(() => {
    return POPULAR_CARD_IDS.map((id) => choices.find((c) => c.contractCardId === id)).filter(
      Boolean,
    ) as CatalogueChoice[];
  }, [choices]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIndex(filtered.length > 0 ? 0 : -1);
  }, [filtered]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.querySelector(`[data-index="${highlightIndex}"]`);
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  function selectChoice(choice: CatalogueChoice) {
    onChange(choice.contractCardId);
    setQuery("");
    setOpen(false);
  }

  function clearSelection() {
    onChange("");
    setQuery("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      e.preventDefault();
      setOpen(true);
      return;
    }

    if (!open) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => (i < flatItems.length - 1 ? i + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => (i > 0 ? i - 1 : flatItems.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightIndex >= 0 && flatItems[highlightIndex]) {
          selectChoice(flatItems[highlightIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  const networkBadge = (network: string) => {
    const colors: Record<string, string> = {
      VISA: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      MASTERCARD: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
      AMEX: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    };
    return colors[network] ?? "bg-muted text-muted-foreground border-border/40";
  };

  return (
    <div className="space-y-3">
      {/* ─── Popular Cards Fast-Pick Bar ────────────────────────────── */}
      {showPopularChips && popularChoices.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Sparkles className="size-3.5 text-amber-500" />
            <span>Popular Cards</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {popularChoices.map((choice) => {
              const isSelected = choice.contractCardId === value;
              return (
                <button
                  key={choice.contractCardId}
                  type="button"
                  onClick={() => onChange(choice.contractCardId)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/30 ring-offset-1"
                      : "bg-muted/60 text-foreground/80 hover:bg-muted hover:text-foreground border border-border/60"
                  }`}
                >
                  <span>{choice.officialName.replace(/(American Express | Visa Infinite| World Elite| Card)/g, "").trim() || choice.officialName}</span>
                  <span className="text-[10px] opacity-75 font-mono">
                    {choice.annualFeeMinor === 0 ? "Free" : `$${Math.round(choice.annualFeeMinor / 100)}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Search Input Trigger ──────────────────────────────────── */}
      <div ref={containerRef} className="relative">
        <div
          className={`flex h-11 w-full items-center gap-2.5 rounded-xl border bg-background px-3.5 text-sm shadow-2xs transition-all cursor-pointer ${
            open
              ? "border-ring ring-2 ring-ring"
              : "border-input hover:border-ring/50"
          }`}
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          {open ? (
            <input
              ref={inputRef}
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/60"
              placeholder="Search by card name, bank, or network…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!open) setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {selected ? (
                <>
                  <span className="truncate font-medium text-foreground">
                    {selected.officialName}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    ({selected.issuer})
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground/70">
                  Search all cards or select below…
                </span>
              )}
            </div>
          )}

          {selected && !open ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearSelection();
              }}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Clear selection"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          )}
        </div>

        {/* ─── Dropdown Menu ────────────────────────────────────────── */}
        {open && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1.5 w-full rounded-2xl border border-border bg-popover shadow-xl animate-in fade-in slide-in-from-top-1 duration-150 overflow-hidden"
            style={{ maxHeight: "min(380px, 60vh)" }}
          >
            {/* Issuer Filter Tabs */}
            <div className="border-b border-border/60 bg-muted/30 p-2 overflow-x-auto no-scrollbar flex items-center gap-1">
              {issuers.map((issuer) => (
                <button
                  key={issuer}
                  type="button"
                  onClick={() => setSelectedIssuer(issuer)}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    selectedIssuer === issuer
                      ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {issuer === "ALL" ? "All Issuers" : issuer.replace(" Bank", "")}
                </button>
              ))}
            </div>

            {/* List of Cards */}
            <div
              className="overflow-y-auto overscroll-contain divide-y divide-border/40"
              style={{ maxHeight: "min(300px, 50vh)" }}
            >
              {grouped.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
                  <CreditCard className="size-6 stroke-[1.5]" />
                  <p className="font-medium text-foreground">No cards found matching &ldquo;{query}&rdquo;</p>
                  <p className="text-[11px]">Try checking for typos or searching by bank name.</p>
                </div>
              ) : (
                grouped.map(([issuer, group]) => (
                  <div key={issuer} className="p-1.5">
                    <div className="px-2.5 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {issuer}
                      </span>
                    </div>
                    <div className="space-y-0.5 mt-0.5">
                      {group.map((choice) => {
                        const flatIndex = flatItems.indexOf(choice);
                        const isHighlighted = flatIndex === highlightIndex;
                        const isSelected = choice.contractCardId === value;

                        return (
                          <button
                            key={choice.contractCardId}
                            type="button"
                            data-index={flatIndex}
                            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-all ${
                              isHighlighted
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-muted/60 text-foreground"
                            } ${isSelected ? "bg-primary/5 font-semibold ring-1 ring-primary/20" : ""}`}
                            onClick={() => selectChoice(choice)}
                            onMouseEnter={() => setHighlightIndex(flatIndex)}
                          >
                            <CardImage
                              contractCardId={choice.contractCardId}
                              nickname={choice.officialName}
                              issuer={choice.issuer}
                              network={choice.network}
                              size="avatar"
                              className="shrink-0 shadow-2xs"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="block truncate text-xs font-semibold leading-tight text-foreground">
                                {choice.officialName}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {choice.annualFeeMinor === 0
                                  ? "No annual fee"
                                  : `$${Math.round(choice.annualFeeMinor / 100)}/year`}
                              </span>
                            </div>
                            <span
                              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold font-mono border ${networkBadge(
                                choice.network,
                              )}`}
                            >
                              {choice.network}
                            </span>
                            {isSelected && (
                              <span className="shrink-0 text-primary text-sm font-bold">✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer: Card Request Link */}
            <div className="border-t border-border/60 bg-muted/20 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Don&apos;t see your card?</span>
              <a
                href="/cards/request"
                className="text-xs font-semibold text-primary hover:underline underline-offset-2 transition-colors"
              >
                Request card addition →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
