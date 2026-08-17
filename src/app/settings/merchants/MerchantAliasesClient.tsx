"use client";

import { useState, useTransition } from "react";
import {
  Check,
  CheckCircle2,
  AlertTriangle,
  Search,
  Sparkles,
  Store,
  Tag,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SPEND_CATEGORIES, CATEGORY_LABELS, type SpendCategory } from "@/lib/cards/types";
import { updateMerchantAlias } from "./actions";

export interface MerchantAliasItem {
  id: string;
  rawString: string;
  normalizedName: string;
  category: string | null;
  sightingsCount: number;
}

interface AliasRowState {
  normalizedName: string;
  category: string;
  isCustomCategory: boolean;
  savedSuccess?: boolean;
  error?: string | null;
}

export default function MerchantAliasesClient({
  initialAliases,
}: {
  initialAliases: MerchantAliasItem[];
}) {
  const [aliases, setAliases] = useState<MerchantAliasItem[]>(initialAliases);
  const [rowStates, setRowStates] = useState<Record<string, AliasRowState>>(() => {
    const initial: Record<string, AliasRowState> = {};
    for (const a of initialAliases) {
      const isKnownCategory = (SPEND_CATEGORIES as readonly string[]).includes(a.category ?? "");
      initial[a.id] = {
        normalizedName: a.normalizedName,
        category: a.category ?? "",
        isCustomCategory: Boolean(a.category && !isKnownCategory),
      };
    }
    return initial;
  });

  const [filterQuery, setFilterQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "needs_curation" | "curated">("all");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const handleFieldChange = (id: string, updates: Partial<AliasRowState>) => {
    setRowStates((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {
          normalizedName: "",
          category: "",
          isCustomCategory: false,
        }),
        ...updates,
        savedSuccess: false,
        error: null,
      },
    }));
  };

  const handleSave = (id: string, original: MerchantAliasItem) => {
    const currentState = rowStates[id];
    if (!currentState) return;

    const trimmedName = currentState.normalizedName.trim();
    if (!trimmedName) {
      handleFieldChange(id, { error: "Merchant name cannot be empty" });
      return;
    }

    const trimmedCategory = currentState.category.trim() || null;

    setPendingIds((prev) => new Set(prev).add(id));
    startTransition(async () => {
      try {
        const result = await updateMerchantAlias({
          id,
          normalizedName: trimmedName,
          category: trimmedCategory,
        });

        if (result.ok) {
          setAliases((prev) =>
            prev.map((a) =>
              a.id === id
                ? {
                    ...a,
                    normalizedName: result.alias.normalizedName,
                    category: result.alias.category,
                  }
                : a,
            ),
          );
          setRowStates((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              normalizedName: result.alias.normalizedName,
              category: result.alias.category ?? "",
              isCustomCategory: Boolean(
                result.alias.category &&
                  !(SPEND_CATEGORIES as readonly string[]).includes(result.alias.category),
              ),
              savedSuccess: true,
              error: null,
            },
          }));
        } else {
          handleFieldChange(id, { error: result.error, savedSuccess: false });
        }
      } catch (err: any) {
        handleFieldChange(id, {
          error: err?.message || "Failed to update alias",
          savedSuccess: false,
        });
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  };

  const handleReset = (id: string, original: MerchantAliasItem) => {
    const isKnownCategory = (SPEND_CATEGORIES as readonly string[]).includes(
      original.category ?? "",
    );
    setRowStates((prev) => ({
      ...prev,
      [id]: {
        normalizedName: original.normalizedName,
        category: original.category ?? "",
        isCustomCategory: Boolean(original.category && !isKnownCategory),
        savedSuccess: false,
        error: null,
      },
    }));
  };

  // Filtered list based on search and curation status
  const filteredAliases = aliases.filter((item) => {
    const state = rowStates[item.id] ?? {
      normalizedName: item.normalizedName,
      category: item.category ?? "",
    };

    // Tab filter
    const isUnresolved = !item.category || item.normalizedName === item.rawString;
    if (activeTab === "needs_curation" && !isUnresolved) return false;
    if (activeTab === "curated" && isUnresolved) return false;

    // Search query filter
    if (!filterQuery.trim()) return true;
    const query = filterQuery.toLowerCase();
    return (
      item.rawString.toLowerCase().includes(query) ||
      item.normalizedName.toLowerCase().includes(query) ||
      state.normalizedName.toLowerCase().includes(query) ||
      (item.category && item.category.toLowerCase().includes(query)) ||
      (state.category && state.category.toLowerCase().includes(query))
    );
  });

  const needsCurationCount = aliases.filter(
    (a) => !a.category || a.normalizedName === a.rawString,
  ).length;
  const curatedCount = aliases.length - needsCurationCount;

  return (
    <div className="space-y-6">
      {/* Header Info Card */}
      <Card className="border-border/80 bg-muted/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Store className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Merchant Alias &amp; Category Curation</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Apple Wallet and card terminals report raw transaction strings (e.g. &ldquo;SQ *CAFE BLEU&rdquo;).
            Clean display names and assign categories here so your transaction history is readable and card reward multipliers accrue accurately.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-lg border border-border/80 bg-background/80 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Sparkles className="size-3.5 text-cyan-600 dark:text-cyan-400" />
              <span>Shared Learning</span>
            </div>
            <p>
              Aliases are matched to transactions appearing in your purchases and wallet captures. Curation updates display names across your purchases and powers the card optimization engine.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Controls Bar: Search & Status Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search raw strings, names, or categories…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs shadow-2xs placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`rounded-full px-3 py-1 font-medium transition-colors cursor-pointer ${
              activeTab === "all"
                ? "bg-foreground text-background"
                : "border border-input bg-background hover:bg-muted text-foreground"
            }`}
          >
            All ({aliases.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("needs_curation")}
            className={`rounded-full px-3 py-1 font-medium transition-colors cursor-pointer ${
              activeTab === "needs_curation"
                ? "bg-foreground text-background"
                : "border border-input bg-background hover:bg-muted text-foreground"
            }`}
          >
            Needs curation ({needsCurationCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("curated")}
            className={`rounded-full px-3 py-1 font-medium transition-colors cursor-pointer ${
              activeTab === "curated"
                ? "bg-foreground text-background"
                : "border border-input bg-background hover:bg-muted text-foreground"
            }`}
          >
            Curated ({curatedCount})
          </button>
        </div>
      </div>

      {/* Merchant List */}
      {filteredAliases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 p-8 text-center">
          <Store className="mx-auto size-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium text-foreground">
            {aliases.length === 0 ? "No merchant aliases found" : "No matching merchants"}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            {aliases.length === 0
              ? "Merchant aliases are automatically populated when you record purchases or capture Apple Wallet events."
              : "Try adjusting your search query or filter tab."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAliases.map((item) => {
            const state = rowStates[item.id] || {
              normalizedName: item.normalizedName,
              category: item.category ?? "",
              isCustomCategory: false,
            };
            const isPending = pendingIds.has(item.id);
            const isDirty =
              state.normalizedName !== item.normalizedName ||
              (state.category || null) !== (item.category || null);
            const isUnresolved = !item.category || item.normalizedName === item.rawString;

            return (
              <div
                key={item.id}
                className={`rounded-xl border bg-card p-4 transition-all ${
                  isDirty
                    ? "border-cyan-500/50 shadow-xs ring-1 ring-cyan-500/20"
                    : "border-border/80 shadow-2xs"
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  {/* Left Column: Raw info & Sightings */}
                  <div className="space-y-1 min-w-[200px] lg:max-w-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground bg-muted/60 px-2 py-0.5 rounded">
                        {item.rawString}
                      </span>
                      {isUnresolved ? (
                        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                          Needs curation
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {item.sightingsCount === 1
                        ? "1 sighting in your data"
                        : `${item.sightingsCount} sightings in your data`}
                    </p>
                  </div>

                  {/* Center Column: Inputs for Normalized Name & Category */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                    {/* Normalized Name Input */}
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Clean display name
                      </label>
                      <input
                        type="text"
                        value={state.normalizedName}
                        onChange={(e) =>
                          handleFieldChange(item.id, { normalizedName: e.target.value })
                        }
                        placeholder="e.g. Café Bleu"
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    {/* Category Selector */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-medium text-muted-foreground">
                          Spend category
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            handleFieldChange(item.id, {
                              isCustomCategory: !state.isCustomCategory,
                            })
                          }
                          className="text-[10px] text-cyan-600 hover:underline cursor-pointer"
                        >
                          {state.isCustomCategory ? "Pick standard" : "Custom text"}
                        </button>
                      </div>

                      {state.isCustomCategory ? (
                        <input
                          type="text"
                          value={state.category}
                          onChange={(e) =>
                            handleFieldChange(item.id, { category: e.target.value })
                          }
                          placeholder="e.g. coffee_shops"
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      ) : (
                        <select
                          value={state.category}
                          onChange={(e) =>
                            handleFieldChange(item.id, { category: e.target.value })
                          }
                          className="h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                        >
                          <option value="">(Uncategorized / None)</option>
                          {SPEND_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {CATEGORY_LABELS[cat]}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Actions & Feedback */}
                  <div className="flex items-center gap-2 justify-end pt-1 lg:pt-0">
                    {isDirty ? (
                      <button
                        type="button"
                        onClick={() => handleReset(item.id, item)}
                        disabled={isPending}
                        title="Revert changes"
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="size-3.5" />
                        <span className="sr-only sm:not-sr-only">Reset</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => handleSave(item.id, item)}
                      disabled={isPending || (!isDirty && !state.error)}
                      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 ${
                        isDirty
                          ? "bg-foreground text-background hover:bg-foreground/90"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {state.savedSuccess ? (
                        <>
                          <Check className="size-3.5 text-emerald-500" />
                          <span>Saved</span>
                        </>
                      ) : (
                        <>
                          <Save className="size-3.5" />
                          <span>{isPending ? "Saving…" : "Save"}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Error Banner */}
                {state.error ? (
                  <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-500/10 p-2 text-xs font-medium text-red-600 border border-red-500/20">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    <span>{state.error}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
