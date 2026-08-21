"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Search, ChevronDown, X, CreditCard } from "lucide-react";
import type { CatalogueChoice } from "@/lib/cards/catalogueCard";

interface CardPickerProps {
  choices: CatalogueChoice[];
  value: string;
  onChange: (contractCardId: string) => void;
}

/**
 * Searchable card picker that replaces a native <select>.
 * Filters by card name and issuer, groups results by issuer,
 * and is fully keyboard-navigable.
 */
export function CardPicker({ choices, value, onChange }: CardPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = choices.find((c) => c.contractCardId === value) ?? null;

  // Filter choices by query (name or issuer)
  const filtered = useMemo(() => {
    if (!query.trim()) return choices;
    const q = query.toLowerCase();
    return choices.filter(
      (c) => c.officialName.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q),
    );
  }, [choices, query]);

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
      VISA: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      MASTERCARD: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
      AMEX: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    };
    return colors[network] ?? "bg-muted text-muted-foreground";
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Input trigger */}
      <div
        className={`flex h-9 w-full items-center gap-2 rounded-lg border bg-background px-3 text-sm shadow-2xs transition-all cursor-pointer ${
          open
            ? "border-ring ring-2 ring-ring"
            : "border-input hover:border-ring/50"
        }`}
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        {open ? (
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            placeholder="Search by card name or issuer…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
        ) : (
          <span className={`flex-1 truncate ${selected ? "text-foreground" : "text-muted-foreground/60"}`}>
            {selected ? selected.officialName : "Search for a card…"}
          </span>
        )}
        {selected && !open ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clearSelection();
            }}
            className="rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-popover shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ maxHeight: "min(320px, 50vh)" }}
        >
          <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: "min(280px, 45vh)" }}>
            {grouped.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground">
                <CreditCard className="size-5" />
                <p>No cards match &ldquo;{query}&rdquo;</p>
              </div>
            ) : (
              grouped.map(([issuer, group]) => (
                <div key={issuer}>
                  <div className="sticky top-0 z-10 bg-popover/95 backdrop-blur-sm border-b border-border/50 px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {issuer}
                    </span>
                  </div>
                  {group.map((choice) => {
                    const flatIndex = flatItems.indexOf(choice);
                    const isHighlighted = flatIndex === highlightIndex;
                    const isSelected = choice.contractCardId === value;

                    return (
                      <button
                        key={choice.contractCardId}
                        type="button"
                        data-index={flatIndex}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                          isHighlighted
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/50"
                        } ${isSelected ? "font-medium" : ""}`}
                        onClick={() => selectChoice(choice)}
                        onMouseEnter={() => setHighlightIndex(flatIndex)}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="block truncate text-xs font-medium">
                            {choice.officialName}
                          </span>
                        </div>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${networkBadge(choice.network)}`}>
                          {choice.network}
                        </span>
                        {isSelected && (
                          <span className="shrink-0 text-primary text-xs">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer: request link */}
          <div className="border-t border-border/50 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              Can&apos;t find your card?{" "}
              <a href="/cards/request" className="underline underline-offset-2 hover:text-foreground transition-colors">
                Request it
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
