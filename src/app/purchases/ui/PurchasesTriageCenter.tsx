"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ChevronRight,
  Coins,
  CreditCard,
  Merge,
  Tag,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { InlineCategoryPicker } from "./InlineCategoryPicker";
import { InlineCurrencyPicker } from "./InlineCurrencyPicker";
import { InlineCardPicker, type CardItem } from "./InlineCardPicker";
import { mergeDuplicatePurchase, keepSeparatePurchase } from "../[id]/actions";
import { toast } from "sonner";

export type TriageIssueType = "currency" | "category" | "card" | "duplicate";

export interface TriageRow {
  id: string;
  merchant: string;
  rawString?: string;
  totalCents: number | null;
  currency: string | null;
  dateLabel: string;
  category: string | null;
  categorySuggestion: { category: string; rationale: string } | null;
  cardRaw: string | null;
  resolvedCardId: string | null;
  paymentMethod: string | null;
  possibleDuplicateOfId: string | null;
  issues: TriageIssueType[];
}

export function PurchasesTriageCenter({
  rows,
  userCards,
}: {
  rows: TriageRow[];
  userCards: CardItem[];
}) {
  const [activeTab, setActiveTab] = useState<"all" | TriageIssueType>("all");
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  // Filter out locally resolved rows
  const activeRows = useMemo(
    () => rows.filter((row) => !resolvedIds.has(row.id)),
    [rows, resolvedIds]
  );

  const missingCurrencyCount = useMemo(
    () => activeRows.filter((r) => r.issues.includes("currency")).length,
    [activeRows]
  );

  const uncategorizedCount = useMemo(
    () => activeRows.filter((r) => r.issues.includes("category")).length,
    [activeRows]
  );

  const unmappedCardsCount = useMemo(
    () => activeRows.filter((r) => r.issues.includes("card")).length,
    [activeRows]
  );

  const duplicatesCount = useMemo(
    () => activeRows.filter((r) => r.issues.includes("duplicate")).length,
    [activeRows]
  );

  const totalActiveIssues = activeRows.length;

  const filteredRows = useMemo(() => {
    if (activeTab === "all") return activeRows;
    return activeRows.filter((r) => r.issues.includes(activeTab));
  }, [activeRows, activeTab]);

  if (totalActiveIssues === 0) {
    return null;
  }

  async function handleDuplicateAction(purchaseId: string, action: "merge" | "separate") {
    try {
      if (action === "merge") {
        await mergeDuplicatePurchase(purchaseId);
        setResolvedIds((prev) => new Set([...prev, purchaseId]));
        toast.success("Merged duplicate purchase");
      } else {
        await keepSeparatePurchase(purchaseId);
        setResolvedIds((prev) => new Set([...prev, purchaseId]));
        toast.success("Marked as separate purchase");
      }
    } catch {
      toast.error("Failed to process duplicate action");
    }
  }

  return (
    <section
      aria-labelledby="purchases-triage-heading"
      className="overflow-hidden rounded-2xl border border-amber-500/25 bg-linear-to-b from-amber-500/5 via-card to-card p-4 sm:p-5 shadow-2xs space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Zap className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2
                id="purchases-triage-heading"
                className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400"
              >
                Purchase Review & Triage
              </h2>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.2 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                {totalActiveIssues} item{totalActiveIssues === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Resolve missing currencies, unmapped cards, and categories in 1 tap to keep your finances spotless.
            </p>
          </div>
        </div>
      </div>

      {/* Segmented Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition shadow-2xs ${
            activeTab === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          All Issues ({totalActiveIssues})
        </button>

        {missingCurrencyCount > 0 ? (
          <button
            type="button"
            onClick={() => setActiveTab("currency")}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs ${
              activeTab === "currency"
                ? "bg-amber-600 text-white"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25"
            }`}
          >
            <Coins className="size-3" />
            <span>Missing Currency ({missingCurrencyCount})</span>
          </button>
        ) : null}

        {uncategorizedCount > 0 ? (
          <button
            type="button"
            onClick={() => setActiveTab("category")}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs ${
              activeTab === "category"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Tag className="size-3" />
            <span>Uncategorized ({uncategorizedCount})</span>
          </button>
        ) : null}

        {unmappedCardsCount > 0 ? (
          <button
            type="button"
            onClick={() => setActiveTab("card")}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs ${
              activeTab === "card"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <CreditCard className="size-3" />
            <span>Unmapped Cards ({unmappedCardsCount})</span>
          </button>
        ) : null}

        {duplicatesCount > 0 ? (
          <button
            type="button"
            onClick={() => setActiveTab("duplicate")}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs ${
              activeTab === "duplicate"
                ? "bg-rose-600 text-white"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25"
            }`}
          >
            <AlertTriangle className="size-3" />
            <span>Duplicates ({duplicatesCount})</span>
          </button>
        ) : null}
      </div>

      {/* Issues List */}
      <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card overflow-hidden">
        {filteredRows.slice(0, 10).map((row) => {
          return (
            <div
              key={row.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 hover:bg-muted/30 transition-colors"
            >
              {/* Left Details */}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/purchases/${row.id}`}
                    className="font-semibold text-sm text-foreground hover:text-primary transition truncate"
                  >
                    {row.merchant}
                  </Link>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{row.dateLabel}</span>
                  {row.totalCents != null ? (
                    <>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs font-bold tabular-nums text-foreground">
                        {(row.totalCents / 100).toFixed(2)}
                      </span>
                    </>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {/* Issue Indicators */}
                  {row.issues.includes("currency") ? (
                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Coins className="size-3" /> Missing currency
                    </span>
                  ) : null}
                  {row.issues.includes("category") ? (
                    <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                      <Tag className="size-3" /> Needs category
                    </span>
                  ) : null}
                  {row.issues.includes("card") ? (
                    <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                      <CreditCard className="size-3" /> Unmapped card ({row.cardRaw})
                    </span>
                  ) : null}
                  {row.issues.includes("duplicate") ? (
                    <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="size-3" /> Flagged duplicate
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Right Action Widgets */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {/* Currency quick buttons if missing */}
                {row.issues.includes("currency") ? (
                  <InlineCurrencyPicker
                    purchaseId={row.id}
                    merchant={row.merchant}
                    currentCurrency={row.currency}
                    totalCents={row.totalCents}
                    variant="triage-chip"
                    onCurrencyChange={() => {
                      setResolvedIds((prev) => new Set([...prev, row.id]));
                    }}
                  />
                ) : null}

                {/* Category picker if missing */}
                {row.issues.includes("category") ? (
                  <InlineCategoryPicker
                    rawString={row.rawString ?? row.merchant}
                    currentCategory={row.category}
                    suggestion={row.categorySuggestion}
                    variant="badge"
                  />
                ) : null}

                {/* Card picker if unmapped */}
                {row.issues.includes("card") ? (
                  <InlineCardPicker
                    purchaseId={row.id}
                    currentCardId={row.resolvedCardId}
                    cardRaw={row.cardRaw}
                    userCards={userCards}
                    variant="inline"
                    onCardChange={() => {
                      setResolvedIds((prev) => new Set([...prev, row.id]));
                    }}
                  />
                ) : null}

                {/* Duplicate Actions */}
                {row.issues.includes("duplicate") ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDuplicateAction(row.id, "merge")}
                      className="cursor-pointer inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/20 transition shadow-2xs"
                    >
                      <Merge className="size-3" /> Merge
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicateAction(row.id, "separate")}
                      className="cursor-pointer inline-flex items-center gap-1 rounded-md border border-border/80 bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition shadow-2xs"
                    >
                      Keep Separate
                    </button>
                  </div>
                ) : null}

                <Link
                  href={`/purchases/${row.id}`}
                  className="p-1 text-muted-foreground hover:text-foreground transition"
                  aria-label={`View purchase details for ${row.merchant}`}
                >
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {filteredRows.length > 10 ? (
        <p className="text-xs text-center text-muted-foreground">
          Showing 10 of {filteredRows.length} items. Scroll down in the main list to see all.
        </p>
      ) : null}
    </section>
  );
}
