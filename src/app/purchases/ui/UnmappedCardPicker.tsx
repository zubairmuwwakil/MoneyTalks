"use client";

import { CreditCard, ChevronDown, Loader2, Check, Plus } from "lucide-react";
import { useTransition, useState, useMemo } from "react";
import { mapWalletCard, addCardAndMapWallet } from "@/app/settings/wallet/actions";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";

type Card = { nickname: string; contractCardId: string; officialName?: string };

/**
 * Scores how well `cardRaw` matches a candidate card name. Returns 0–1.
 * Uses token overlap: what fraction of the raw string's tokens appear in the
 * candidate (or vice versa).
 */
function matchScore(cardRaw: string, ...candidates: (string | undefined)[]): number {
  const rawTokens = tokenize(cardRaw);
  if (rawTokens.length === 0) return 0;
  let best = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const candTokens = tokenize(candidate);
    if (candTokens.length === 0) continue;
    const fwd = rawTokens.filter((t) => candTokens.includes(t)).length / rawTokens.length;
    const rev = candTokens.filter((t) => rawTokens.includes(t)).length / candTokens.length;
    best = Math.max(best, fwd, rev);
  }
  return best;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const AUTO_SUGGEST_THRESHOLD = 0.5;

export function UnmappedCardPicker({
  cardRaw,
  cards,
}: {
  cardRaw: string;
  cards: Card[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 1. Evaluate matches against user's existing saved cards
  const { sortedUserCards, bestUserMatch } = useMemo(() => {
    const scored = cards.map((c) => ({
      card: c,
      score: matchScore(cardRaw, c.nickname, c.officialName, c.contractCardId.replace(/-/g, " ")),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    return {
      sortedUserCards: scored.map((s) => s.card),
      bestUserMatch: top && top.score >= AUTO_SUGGEST_THRESHOLD ? top.card : null,
    };
  }, [cardRaw, cards]);

  // 2. Evaluate matches against all cards in the catalogue (for single-click "Add & Link")
  const { sortedCatalogueCards, bestCatalogueMatch } = useMemo(() => {
    const scored = cardCatalogue.cards.map((c) => ({
      card: { contractCardId: c.cardId, officialName: c.officialName },
      score: matchScore(cardRaw, c.officialName, c.cardId.replace(/-/g, " ")),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    return {
      sortedCatalogueCards: scored.slice(0, 8).map((s) => s.card), // top 8 candidates
      bestCatalogueMatch: top && top.score >= AUTO_SUGGEST_THRESHOLD ? top.card : null,
    };
  }, [cardRaw]);

  // Map to an existing saved card
  function handleMapExisting(contractCardId: string) {
    startTransition(async () => {
      await mapWalletCard({ rawString: cardRaw, contractCardId });
      setExpanded(false);
    });
  }

  // Create new CreditCard from catalogue AND map raw wallet string
  function handleAddAndMap(contractCardId: string) {
    startTransition(async () => {
      await addCardAndMapWallet({ rawString: cardRaw, contractCardId });
      setExpanded(false);
    });
  }

  // A. Strong match found on a USER's existing saved card
  if (!expanded && bestUserMatch) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CreditCard className="size-3 text-amber-500 shrink-0" />
        <span className="truncate max-w-[120px] text-amber-600 dark:text-amber-400 font-medium" title={cardRaw}>
          {cardRaw}
        </span>
        <span className="text-muted-foreground/60">→</span>
        {isPending ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : (
          <button
            type="button"
            onClick={() => handleMapExisting(bestUserMatch.contractCardId)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer font-semibold border border-emerald-500/20"
            title={`Link "${cardRaw}" to your ${bestUserMatch.nickname}`}
          >
            <Check className="size-3 shrink-0" />
            <span className="truncate max-w-[140px]">{bestUserMatch.nickname}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
          title="Choose a different card"
        >
          <ChevronDown className="size-3" />
        </button>
      </span>
    );
  }

  // B. Strong match found in CATALOGUE (and user hasn't added this card yet)
  if (!expanded && bestCatalogueMatch) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CreditCard className="size-3 text-amber-500 shrink-0" />
        <span className="truncate max-w-[120px] text-amber-600 dark:text-amber-400 font-medium" title={cardRaw}>
          {cardRaw}
        </span>
        <span className="text-muted-foreground/60">→</span>
        {isPending ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : (
          <button
            type="button"
            onClick={() => handleAddAndMap(bestCatalogueMatch.contractCardId)}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer font-semibold"
            title={`Add ${bestCatalogueMatch.officialName} to your cards & link wallet`}
          >
            <Plus className="size-3 shrink-0" />
            <span>Add {bestCatalogueMatch.officialName}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
          title="Choose a different card"
        >
          <ChevronDown className="size-3" />
        </button>
      </span>
    );
  }

  // C. Unexpanded view with no strong auto-suggestion
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer font-medium"
        title={`Unlinked card "${cardRaw}". Click to link or add card.`}
      >
        <CreditCard className="size-3 shrink-0 text-amber-500" />
        <span className="truncate max-w-[130px]">{cardRaw}</span>
        <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400 underline">
          + Link Card
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-70" />
      </button>
    );
  }

  // D. Expanded Select Dropdown
  return (
    <span className="inline-flex items-center gap-1.5">
      <CreditCard className="size-3 text-amber-500 shrink-0" />
      {isPending ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <select
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition max-w-[220px]"
          defaultValue=""
          onChange={(e) => {
            const val = e.target.value;
            if (!val) return;
            if (val.startsWith("user:")) {
              handleMapExisting(val.replace("user:", ""));
            } else if (val.startsWith("cat:")) {
              handleAddAndMap(val.replace("cat:", ""));
            }
          }}
          onBlur={() => setExpanded(false)}
        >
          <option value="" disabled>
            Select or Add Card…
          </option>

          {sortedUserCards.length > 0 ? (
            <optgroup label="Your Saved Cards">
              {sortedUserCards.map((c) => (
                <option key={c.contractCardId} value={`user:${c.contractCardId}`}>
                  {c.nickname}
                </option>
              ))}
            </optgroup>
          ) : null}

          <optgroup label="Add & Link from Catalogue">
            {sortedCatalogueCards.map((c) => (
              <option key={c.contractCardId} value={`cat:${c.contractCardId}`}>
                + Add {c.officialName}
              </option>
            ))}
          </optgroup>
        </select>
      )}
    </span>
  );
}
