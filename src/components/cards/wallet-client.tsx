"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  CreditCard,
  Search,
  X,
  Plus,
  Settings2,
  FileSpreadsheet,
  CalendarClock,
  Sparkles,
  LayoutGrid,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { WalletImpactWorkspace } from "./wallet-impact-workspace";
import type { WalletImpactView } from "@/lib/domain/cards/walletImpact";
import { CardTile, type CardTileData } from "./card-tile";
import { CategoryCheatSheet } from "./category-cheat-sheet";
import { RenewalManagerModal, type RenewalModalCardItem } from "./renewal-manager-modal";
import type { FeeCycle } from "@/lib/cards/feeSchedule";
import type { CheatSheetCategoryItem } from "@/lib/cards/cardPresentation";

export interface WalletOperationalStats {
  missingRenewalDateCount: number;
  closestRenewalNote: string | null;
  closestRenewalDays: number | null;
  decisionWindowCount: number;
}

type FilterType = "all" | "fee" | "no-fee" | "amex" | "visa" | "mastercard";
type ViewMode = "cards" | "cheatsheet";

export function WalletClient({
  cards,
  cycles,
  stats,
  impact,
  categories,
  todayIso,
}: {
  cards: CardTileData[];
  cycles: (FeeCycle | null)[];
  stats: WalletOperationalStats;
  impact: WalletImpactView;
  categories: CheatSheetCategoryItem[];
  todayIso: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [isRenewalModalOpen, setIsRenewalModalOpen] = useState(false);

  const today = useMemo(() => new Date(todayIso), [todayIso]);

  // Cards missing renewal dates for the modal
  const feeCardsForModal: RenewalModalCardItem[] = useMemo(() => {
    return cards
      .filter((c) => !c.unverified && Math.max(0, c.annualFeeMinor - c.feeRebateMinor) > 0)
      .map((c) => ({
        id: c.id,
        nickname: c.nickname,
        issuer: c.issuer,
        network: c.network,
        annualFeeMinor: c.annualFeeMinor,
        feeRebateMinor: c.feeRebateMinor,
        feeMonthDay: c.feeMonthDay,
        feeCancelGraceDays: c.feeCancelGraceDays,
      }));
  }, [cards]);

  // Filter and search logic
  const filteredCardsWithIndex = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return cards
      .map((card, index) => ({ card, feeCycle: cycles[index], index }))
      .filter(({ card }) => {
        const effectiveFee = Math.max(0, card.annualFeeMinor - card.feeRebateMinor);

        // Filter tabs
        if (activeFilter === "fee" && (card.unverified || effectiveFee === 0)) return false;
        if (activeFilter === "no-fee" && (card.unverified || effectiveFee > 0)) return false;
        if (activeFilter === "amex" && card.network.toUpperCase() !== "AMEX") return false;
        if (activeFilter === "visa" && card.network.toUpperCase() !== "VISA") return false;
        if (activeFilter === "mastercard" && card.network.toUpperCase() !== "MASTERCARD") return false;

        // Search query
        if (!q) return true;
        const haystack = `${card.nickname} ${card.issuer} ${card.network} ${card.lastFour ?? ""} ${
          card.contractCardId ?? ""
        }`.toLowerCase();
        return haystack.includes(q);
      });
  }, [cards, cycles, activeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header with Title and Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wallet</h1>
          <p className="text-sm text-muted-foreground">
            Credit cards, reward multipliers, spending caps, and annual fee verdicts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/cards/reconcile" className="flex items-center gap-1.5">
              <FileSpreadsheet className="size-3.5" />
              <span>Reconcile</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/cards/manage" className="flex items-center gap-1.5">
              <Settings2 className="size-3.5" />
              <span>Manage</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/cards/new" className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              <span>Add card</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Portfolio impact workspace */}
      {impact.rows.length > 0 ? (
        <WalletImpactWorkspace view={impact} />
      ) : null}

      {/* Renewal context stays visible beside the annual-fee verdict. */}
      {stats.closestRenewalNote || stats.decisionWindowCount > 0 ? (
        <div
          className={`flex flex-col justify-between gap-3 rounded-xl border px-4 py-3 text-xs sm:flex-row sm:items-center ${
            stats.decisionWindowCount > 0
              ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
              : "border-border/80 bg-muted/25 text-foreground"
          }`}
        >
          <div className="flex min-w-0 items-start gap-2">
            <CalendarClock className={`mt-0.5 size-4 shrink-0 ${stats.decisionWindowCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <strong>
                {stats.decisionWindowCount > 0
                  ? `${stats.decisionWindowCount} renewal decision window${stats.decisionWindowCount === 1 ? "" : "s"} open`
                  : "Next fee renewal"}
              </strong>
              {stats.closestRenewalNote ? (
                <p className="mt-0.5 text-muted-foreground">{stats.closestRenewalNote}</p>
              ) : null}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 bg-background/80 text-xs hover:bg-background"
            onClick={() => setIsRenewalModalOpen(true)}
          >
            Manage renewal dates
          </Button>
        </div>
      ) : null}

      {/* Missing Renewal Dates Actionable Banner */}
      {stats.missingRenewalDateCount > 0 ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>{stats.missingRenewalDateCount} fee card{stats.missingRenewalDateCount === 1 ? "" : "s"}</strong>{" "}
              {stats.missingRenewalDateCount === 1 ? "has" : "have"} no renewal date set — add dates to track your cancellation grace period.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-500/40 bg-background/80 hover:bg-background shrink-0 text-amber-900 dark:text-amber-200"
            onClick={() => setIsRenewalModalOpen(true)}
          >
            <CalendarClock className="size-3.5 mr-1" />
            <span>Set renewal dates</span>
          </Button>
        </div>
      ) : null}

      {/* View Switcher & Controls */}
      {cards.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-4">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-1">
            <button
              onClick={() => setViewMode("cards")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                viewMode === "cards"
                  ? "bg-background text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="size-3.5" />
              <span>Cards ({cards.length})</span>
            </button>
            <button
              onClick={() => setViewMode("cheatsheet")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                viewMode === "cheatsheet"
                  ? "bg-background text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="size-3.5 text-amber-500" />
              <span>Spend Cheat Sheet</span>
            </button>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Search cards, perks, issuers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8.5 w-full rounded-lg border border-input bg-background pl-8 pr-7 text-xs shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Filter Chips (Visible when in Cards view) */}
      {cards.length > 0 && viewMode === "cards" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Filter:</span>
          {(
            [
              { id: "all", label: `All (${cards.length})` },
              {
                id: "fee",
                label: `Fee Cards (${cards.filter((c) => !c.unverified && c.annualFeeMinor - c.feeRebateMinor > 0).length})`,
              },
              {
                id: "no-fee",
                label: `No Fee (${cards.filter((c) => !c.unverified && c.annualFeeMinor - c.feeRebateMinor === 0).length})`,
              },
              {
                id: "amex",
                label: `Amex (${cards.filter((c) => c.network.toUpperCase() === "AMEX").length})`,
              },
              {
                id: "visa",
                label: `Visa (${cards.filter((c) => c.network.toUpperCase() === "VISA").length})`,
              },
              {
                id: "mastercard",
                label: `Mastercard (${cards.filter((c) => c.network.toUpperCase() === "MASTERCARD").length})`,
              },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              onClick={() => setActiveFilter(pill.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                activeFilter === pill.id
                  ? "bg-foreground text-background font-medium"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Main View Area */}
      {cards.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No cards in wallet yet"
          description="Add your cards to track rewards, multi-spend category bonuses, credits, and fee waivers."
          action={{
            label: "Add your first card",
            href: "/cards/new",
          }}
          secondaryAction={{
            label: "Import from JSON",
            href: "/investments/import",
          }}
        />
      ) : viewMode === "cheatsheet" ? (
        <CategoryCheatSheet categories={categories} />
      ) : filteredCardsWithIndex.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">No cards match your search</p>
          <p className="text-xs text-muted-foreground mt-1">Try searching for a different card name or clear filters.</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => {
              setSearchQuery("");
              setActiveFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filteredCardsWithIndex.map(({ card, feeCycle }) => (
            <CardTile
              key={card.id}
              card={card}
              feeCycle={feeCycle}
              today={today}
              onSetRenewalDate={() => setIsRenewalModalOpen(true)}
            />
          ))}
        </div>
      )}

      {/* Renewal Manager Modal */}
      <RenewalManagerModal
        isOpen={isRenewalModalOpen}
        onClose={() => setIsRenewalModalOpen(false)}
        cards={feeCardsForModal}
      />
    </div>
  );
}
