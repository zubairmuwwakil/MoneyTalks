"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Check,
  ChevronDown,
  CreditCard,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { addCardAndMapWallet, mapWalletCard } from "@/app/settings/wallet/actions";
import { cardCatalogue, publishedCards } from "@/lib/contracts/cardCatalogue";
import {
  cardLabelsMatchSearch,
  confidentCardMatch,
  rankCardMatches,
} from "./cardMatch";

type Card = { nickname: string; contractCardId: string; officialName?: string };
type CatalogueCard = (typeof cardCatalogue.cards)[number];
type LinkChoice =
  | { kind: "existing"; contractCardId: string; label: string }
  | { kind: "catalogue"; contractCardId: string; label: string };

function userCardLabels(card: Card): Array<string | undefined> {
  return [card.nickname, card.officialName, card.contractCardId.replace(/-/g, " ")];
}

function catalogueCardLabels(card: CatalogueCard): string[] {
  return [card.officialName, card.issuer, card.cardId.replace(/-/g, " ")];
}

export function UnmappedCardPicker({
  cardRaw,
  cards,
}: {
  cardRaw: string;
  cards: Card[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkedLabel, setLinkedLabel] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const rankedUserCards = useMemo(
    () => rankCardMatches(cardRaw, cards, userCardLabels),
    [cardRaw, cards],
  );
  const rankedCatalogueCards = useMemo(
    () => rankCardMatches(cardRaw, publishedCards(), catalogueCardLabels),
    [cardRaw],
  );
  const bestUserMatch = confidentCardMatch(rankedUserCards);
  const bestCatalogueMatch = confidentCardMatch(rankedCatalogueCards);

  const ownedContractIds = useMemo(
    () => new Set(cards.map((card) => card.contractCardId)),
    [cards],
  );

  const visibleUserCards = useMemo(() => {
    const basis = query.trim() || cardRaw;
    return rankCardMatches(basis, cards, userCardLabels)
      .map((match) => match.candidate)
      .filter((card) => !query.trim() || cardLabelsMatchSearch(userCardLabels(card), query));
  }, [cardRaw, cards, query]);

  const visibleCatalogueCards = useMemo(() => {
    const available = publishedCards().filter((card) => !ownedContractIds.has(card.cardId));
    const basis = query.trim() || cardRaw;
    return rankCardMatches(basis, available, catalogueCardLabels)
      .map((match) => match.candidate)
      .filter(
        (card) => !query.trim() || cardLabelsMatchSearch(catalogueCardLabels(card), query),
      );
  }, [cardRaw, ownedContractIds, query]);

  function setChooserOpen(open: boolean) {
    if (isPending && !open) return;
    setExpanded(open);
    if (!open) {
      setQuery("");
      setError(null);
    }
  }

  function handleLink(choice: LinkChoice) {
    setError(null);
    startTransition(async () => {
      try {
        const result =
          choice.kind === "existing"
            ? await mapWalletCard({
                rawString: cardRaw,
                contractCardId: choice.contractCardId,
              })
            : await addCardAndMapWallet({
                rawString: cardRaw,
                contractCardId: choice.contractCardId,
              });

        if (!result.ok) {
          setError(result.error);
          toast.error("Card could not be linked", { description: result.error });
          return;
        }

        setLinkedLabel(choice.label);
        setExpanded(false);
        toast.success("Card linked", {
          description: "Future purchases with this Wallet card will match automatically.",
        });
      } catch {
        const message = "Something went wrong while linking this card. Please try again.";
        setError(message);
        toast.error("Card could not be linked", { description: message });
      }
    });
  }

  if (linkedLabel) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 animate-in fade-in-0 dark:text-emerald-400">
        <Check className="size-3.5" />
        <span className="truncate max-w-[180px]">{linkedLabel}</span>
        <span className="sr-only">Card linked. Future purchases will match automatically.</span>
      </span>
    );
  }

  const suggestedChoice: LinkChoice | null = bestUserMatch
    ? {
        kind: "existing",
        contractCardId: bestUserMatch.contractCardId,
        label: bestUserMatch.nickname,
      }
    : bestCatalogueMatch
      ? {
          kind: "catalogue",
          contractCardId: bestCatalogueMatch.cardId,
          label: bestCatalogueMatch.officialName,
        }
      : null;

  return (
    <Dialog.Root open={expanded} onOpenChange={setChooserOpen}>
      {suggestedChoice ? (
        <span className="inline-flex max-w-full items-center gap-1.5">
          <CreditCard className="size-3 shrink-0 text-amber-500" />
          <span
            className="max-w-[105px] truncate font-medium text-amber-600 dark:text-amber-400"
            title={cardRaw}
          >
            {cardRaw}
          </span>
          <span className="text-muted-foreground/60">→</span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleLink(suggestedChoice)}
            className="inline-flex max-w-[190px] cursor-pointer items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
            title={`Confirm ${suggestedChoice.label}`}
          >
            {isPending ? (
              <Loader2 className="size-3 shrink-0 animate-spin" />
            ) : (
              <Check className="size-3 shrink-0" />
            )}
            <span className="truncate">Confirm {suggestedChoice.label}</span>
          </button>
          <Dialog.Trigger
            aria-label="Choose a different card"
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className="size-3" />
          </Dialog.Trigger>
        </span>
      ) : (
        <Dialog.Trigger
          title={`New card detected: ${cardRaw}. Choose the exact card.`}
          className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
        >
          <CreditCard className="size-3 shrink-0 text-amber-500" />
          <span className="truncate max-w-[120px]">New card · {cardRaw}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 underline dark:text-amber-400">
            Choose
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        </Dialog.Trigger>
      )}

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs animate-in fade-in-0 duration-150" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <Dialog.Popup
            initialFocus
            className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border/80 bg-popover shadow-2xl outline-none animate-in slide-in-from-bottom-2 duration-200 sm:rounded-2xl sm:zoom-in-95"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-foreground">
                  Link this new card
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  Wallet reported <span className="font-medium text-foreground">“{cardRaw}”</span>.
                  Choose it once and future purchases will match automatically.
                </Dialog.Description>
              </div>
              <Dialog.Close
                disabled={isPending}
                aria-label="Close card chooser"
                className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>

            <div className="border-b border-border/70 px-5 py-3">
              <label className="relative block">
                <span className="sr-only">Search saved cards and the card catalogue</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search issuer or card name…"
                  className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm text-foreground shadow-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </label>
              {error ? (
                <p role="alert" className="mt-2 text-xs font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {visibleUserCards.length > 0 ? (
                <section aria-labelledby="saved-cards-heading">
                  <h3
                    id="saved-cards-heading"
                    className="px-3 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Your saved cards
                  </h3>
                  {visibleUserCards.map((card) => (
                    <CardChoiceButton
                      key={card.contractCardId}
                      disabled={isPending}
                      icon="check"
                      label={card.nickname}
                      detail={card.officialName ?? "Already saved"}
                      onClick={() =>
                        handleLink({
                          kind: "existing",
                          contractCardId: card.contractCardId,
                          label: card.nickname,
                        })
                      }
                    />
                  ))}
                </section>
              ) : null}

              {visibleCatalogueCards.length > 0 ? (
                <section aria-labelledby="catalogue-cards-heading" className="mt-2">
                  <h3
                    id="catalogue-cards-heading"
                    className="px-3 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Card catalogue
                  </h3>
                  {visibleCatalogueCards.map((card) => (
                    <CardChoiceButton
                      key={card.cardId}
                      disabled={isPending}
                      icon="plus"
                      label={card.officialName}
                      detail={`${card.issuer} · ${card.network}`}
                      onClick={() =>
                        handleLink({
                          kind: "catalogue",
                          contractCardId: card.cardId,
                          label: card.officialName,
                        })
                      }
                    />
                  ))}
                </section>
              ) : null}

              {visibleUserCards.length === 0 && visibleCatalogueCards.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">No matching cards</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try the issuer or a shorter product name.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-5 py-3 text-xs">
              <span className="text-muted-foreground">Can’t find the exact product?</span>
              <Link
                href="/cards/request"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Request a card
              </Link>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CardChoiceButton({
  detail,
  disabled,
  icon,
  label,
  onClick,
}: {
  detail: string;
  disabled: boolean;
  icon: "check" | "plus";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-50"
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground shadow-2xs transition-colors group-hover:border-primary/30 group-hover:text-primary">
        <CreditCard className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
        {icon === "check" ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
        {icon === "check" ? "Use" : "Add"}
      </span>
    </button>
  );
}
