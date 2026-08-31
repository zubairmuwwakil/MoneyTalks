"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  Loader2,
  Plus,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { addCardAndMapWallet, mapWalletCard } from "@/app/settings/wallet/actions";
import { setPurchaseCard } from "../[id]/actions";
import { cardCatalogue, publishedCards } from "@/lib/contracts/cardCatalogue";
import {
  cardLabelsMatchSearch,
  confidentCardMatch,
  rankCardMatches,
} from "./cardMatch";

export type CardItem = {
  nickname: string;
  contractCardId: string;
  officialName?: string;
  network?: string | null;
  issuer?: string | null;
};

type CatalogueCard = (typeof cardCatalogue.cards)[number];

const OTHER_PAYMENT_METHODS = [
  { id: "Interac Debit", label: "Interac Debit", icon: Banknote },
  { id: "Cash", label: "Cash", icon: Banknote },
  { id: "Bank Transfer", label: "Bank Transfer", icon: Wallet },
  { id: "Apple Cash", label: "Apple Cash", icon: Wallet },
  { id: "Gift Card / Store Credit", label: "Store Credit", icon: CreditCard },
] as const;

function userCardLabels(card: CardItem): Array<string | undefined> {
  return [card.nickname, card.officialName, card.contractCardId.replace(/-/g, " ")];
}

function catalogueCardLabels(card: CatalogueCard): string[] {
  return [card.officialName, card.issuer, card.cardId.replace(/-/g, " ")];
}

function getCardGradient(network?: string | null, issuer?: string | null) {
  const net = (network ?? "").toLowerCase();
  const iss = (issuer ?? "").toLowerCase();
  if (net.includes("amex") || iss.includes("american express")) {
    return "from-sky-700 via-blue-800 to-indigo-950 text-white border-sky-400/30";
  }
  if (net.includes("mastercard") || iss.includes("tangerine") || iss.includes("bmo")) {
    return "from-amber-600 via-orange-700 to-red-900 text-white border-orange-400/30";
  }
  if (net.includes("visa") || iss.includes("scotiabank") || iss.includes("td") || iss.includes("cibc")) {
    return "from-emerald-700 via-teal-800 to-slate-950 text-white border-emerald-400/30";
  }
  return "from-slate-700 via-slate-800 to-zinc-950 text-white border-slate-500/30";
}

export function InlineCardPicker({
  purchaseId,
  currentCardId,
  currentCardLabel,
  cardRaw,
  userCards,
  variant = "inline",
  onCardChange,
}: {
  purchaseId: string;
  currentCardId?: string | null;
  currentCardLabel?: string | null;
  /** Present when a WalletEvent has an unmapped or raw card name */
  cardRaw?: string | null;
  userCards: CardItem[];
  variant?: "inline" | "badge" | "hero";
  onCardChange?: (cardIdOrNickname: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeLabel, setActiveLabel] = useState<string | null>(currentCardLabel ?? null);
  const [isPending, startTransition] = useTransition();

  const isUnmapped = Boolean(cardRaw && !currentCardId);

  // Ranked suggestions if cardRaw is present
  const rankedUserCards = useMemo(
    () => (cardRaw ? rankCardMatches(cardRaw, userCards, userCardLabels) : []),
    [cardRaw, userCards]
  );
  const rankedCatalogueCards = useMemo(
    () => (cardRaw ? rankCardMatches(cardRaw, publishedCards(), catalogueCardLabels) : []),
    [cardRaw]
  );
  const bestUserMatch = confidentCardMatch(rankedUserCards);
  const bestCatalogueMatch = confidentCardMatch(rankedCatalogueCards);

  const ownedContractIds = useMemo(
    () => new Set(userCards.map((c) => c.contractCardId)),
    [userCards]
  );

  const visibleUserCards = useMemo(() => {
    const basis = query.trim() || cardRaw || "";
    if (!basis) return userCards;
    return rankCardMatches(basis, userCards, userCardLabels)
      .map((match) => match.candidate)
      .filter((card) => !query.trim() || cardLabelsMatchSearch(userCardLabels(card), query));
  }, [cardRaw, query, userCards]);

  const visibleCatalogueCards = useMemo(() => {
    const available = publishedCards().filter((card) => !ownedContractIds.has(card.cardId));
    const basis = query.trim() || cardRaw || "";
    if (!basis && !query.trim()) return [];
    return rankCardMatches(basis, available, catalogueCardLabels)
      .map((match) => match.candidate)
      .filter(
        (card) => !query.trim() || cardLabelsMatchSearch(catalogueCardLabels(card), query)
      );
  }, [cardRaw, ownedContractIds, query]);

  function handleSelect(choice: {
    kind: "userCard" | "catalogueCard" | "other";
    contractCardId?: string;
    label: string;
  }) {
    startTransition(async () => {
      setActiveLabel(choice.label);
      setOpen(false);
      onCardChange?.(choice.label);

      try {
        if (choice.kind === "other") {
          const res = await setPurchaseCard({
            purchaseId,
            cardIdOrNickname: choice.label,
          });
          if (res.ok) {
            toast.success(`Payment set to ${choice.label}`);
          } else {
            setActiveLabel(currentCardLabel ?? null);
            toast.error(res.error ?? "Failed to update payment method");
          }
          return;
        }

        if (choice.kind === "userCard" && choice.contractCardId) {
          if (cardRaw) {
            const mapRes = await mapWalletCard({
              rawString: cardRaw,
              contractCardId: choice.contractCardId,
            });
            if (!mapRes.ok) throw new Error(mapRes.error);
          }
          const res = await setPurchaseCard({
            purchaseId,
            cardIdOrNickname: choice.contractCardId,
            rememberAliasForRawString: cardRaw ?? undefined,
          });
          if (res.ok) {
            toast.success(`Linked to ${choice.label}`);
          } else {
            setActiveLabel(currentCardLabel ?? null);
            toast.error(res.error ?? "Failed to update payment card");
          }
          return;
        }

        if (choice.kind === "catalogueCard" && choice.contractCardId) {
          if (cardRaw) {
            const addRes = await addCardAndMapWallet({
              rawString: cardRaw,
              contractCardId: choice.contractCardId,
            });
            if (!addRes.ok) throw new Error(addRes.error);
          }
          const res = await setPurchaseCard({
            purchaseId,
            cardIdOrNickname: choice.contractCardId,
            rememberAliasForRawString: cardRaw ?? undefined,
          });
          if (res.ok) {
            toast.success(`Added ${choice.label} and linked`);
          } else {
            setActiveLabel(currentCardLabel ?? null);
            toast.error(res.error ?? "Failed to link catalogue card");
          }
        }
      } catch (err) {
        setActiveLabel(currentCardLabel ?? null);
        toast.error(err instanceof Error ? err.message : "Error saving card");
      }
    });
  }

  // Quick 1-tap suggestion if high confidence
  const quickSuggestion = bestUserMatch
    ? {
        kind: "userCard" as const,
        contractCardId: bestUserMatch.contractCardId,
        label: bestUserMatch.nickname,
      }
    : bestCatalogueMatch
      ? {
          kind: "catalogueCard" as const,
          contractCardId: bestCatalogueMatch.cardId,
          label: bestCatalogueMatch.officialName,
        }
      : null;

  if (isUnmapped && quickSuggestion && variant === "inline") {
    return (
      <div className="inline-flex items-center gap-1.5">
        <CreditCard className="size-3 text-amber-500 shrink-0" />
        <span className="text-amber-600 dark:text-amber-400 font-medium text-xs truncate max-w-[110px]">
          {cardRaw}
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => handleSelect(quickSuggestion)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300 transition shadow-2xs"
          title={`Confirm ${quickSuggestion.label}`}
        >
          {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          <span className="truncate max-w-[130px]">{quickSuggestion.label}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          title="Choose a different card"
        >
          <ChevronDown className="size-3" />
        </button>
        {renderDialog()}
      </div>
    );
  }

  if (variant === "hero") {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-2xs">
            <CreditCard className="size-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Payment Method
            </p>
            <p className="text-sm font-bold text-foreground">
              {activeLabel ?? (isUnmapped ? `Unmapped: ${cardRaw}` : "Unspecified card")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border/80 bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition"
        >
          {isPending ? <Loader2 className="size-3 animate-spin" /> : <CreditCard className="size-3 text-primary" />}
          <span>Change card</span>
        </button>
        {renderDialog()}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-muted/80 ${
          isUnmapped
            ? "border border-amber-500/30 bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-300"
            : "text-muted-foreground hover:text-foreground font-medium"
        }`}
        title={isUnmapped ? `Unmapped card "${cardRaw}". Click to choose.` : `Paid with: ${activeLabel ?? "Card"}. Click to change.`}
      >
        <CreditCard className={`size-3 shrink-0 ${isUnmapped ? "text-amber-500" : "text-muted-foreground/80"}`} />
        <span className="truncate max-w-[140px]">{activeLabel ?? cardRaw ?? "Card"}</span>
        <ChevronDown className="size-2.5 opacity-60 shrink-0" />
      </button>
      {renderDialog()}
    </>
  );

  function renderDialog() {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-150" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <Dialog.Popup
              initialFocus
              className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border/80 bg-popover shadow-2xl outline-none animate-in slide-in-from-bottom-2 duration-200 sm:rounded-2xl sm:zoom-in-95"
            >
              {/* Dialog Header */}
              <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <CreditCard className="size-4" />
                    </div>
                    <Dialog.Title className="text-base font-semibold text-foreground">
                      Select Payment Card
                    </Dialog.Title>
                  </div>
                  <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                    {cardRaw ? (
                      <>Wallet captured: <span className="font-medium text-foreground">“{cardRaw}”</span>. Choose the card to link.</>
                    ) : (
                      <>Assign which credit card or payment method was used for this purchase.</>
                    )}
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  disabled={isPending}
                  aria-label="Close card selector"
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-4" />
                </Dialog.Close>
              </div>

              {/* Search Bar */}
              <div className="border-b border-border/70 px-5 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your cards or catalogue (e.g. Cobalt, Visa Infinite, RBC)..."
                    className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm text-foreground shadow-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </div>

              {/* Card List */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
                {/* 1. Saved Cards */}
                {visibleUserCards.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1 pb-2">
                      Your Connected Cards
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {visibleUserCards.map((card) => {
                        const gradient = getCardGradient(card.network, card.issuer);
                        const isSelected = activeLabel === card.nickname || currentCardId === card.contractCardId;
                        return (
                          <button
                            key={card.contractCardId}
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              handleSelect({
                                kind: "userCard",
                                contractCardId: card.contractCardId,
                                label: card.nickname,
                              })
                            }
                            className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition-all cursor-pointer shadow-2xs hover:scale-[1.02] ${
                              isSelected
                                ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                                : "border-border/80 bg-card hover:border-border hover:bg-muted/40"
                            }`}
                          >
                            <div
                              className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br ${gradient} shadow-xs font-bold text-xs`}
                            >
                              <CreditCard className="size-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-sm text-foreground truncate">
                                  {card.nickname}
                                </span>
                                {isSelected ? <Check className="size-4 text-primary shrink-0" /> : null}
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {card.officialName ?? card.issuer ?? card.contractCardId}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* 2. Catalogue Cards (if searching or mapping) */}
                {visibleCatalogueCards.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1 pb-2">
                      Add & Link from Catalogue
                    </p>
                    <div className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card overflow-hidden">
                      {visibleCatalogueCards.slice(0, 8).map((cat) => (
                        <button
                          key={cat.cardId}
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            handleSelect({
                              kind: "catalogueCard",
                              contractCardId: cat.cardId,
                              label: cat.officialName,
                            })
                          }
                          className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-muted/50 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {cat.officialName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {cat.issuer} · {cat.network}
                            </p>
                          </div>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                            <Plus className="size-3" /> Link
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* 3. Other Payment Methods */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1 pb-2">
                    Other Payment Methods
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {OTHER_PAYMENT_METHODS.map((method) => {
                      const Icon = method.icon;
                      const isSelected = activeLabel === method.label;
                      return (
                        <button
                          key={method.id}
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            handleSelect({
                              kind: "other",
                              label: method.label,
                            })
                          }
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition cursor-pointer shadow-2xs ${
                            isSelected
                              ? "border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/30"
                              : "border-border/80 bg-card text-foreground hover:bg-muted"
                          }`}
                        >
                          <Icon className="size-3.5 text-muted-foreground" />
                          <span>{method.label}</span>
                          {isSelected ? <Check className="size-3 text-primary ml-0.5" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
}
