"use client";

import { CreditCard, ChevronDown, Loader2, Check } from "lucide-react";
import { useTransition, useState, useMemo } from "react";
import { mapWalletCard } from "@/app/settings/wallet/actions";

type Card = { nickname: string; contractCardId: string; officialName?: string };

/**
 * Scores how well `cardRaw` matches a candidate card name. Returns 0–1.
 * Uses token overlap: what fraction of the raw string's tokens appear in the
 * candidate (or vice versa). This handles Apple Wallet strings like
 * "American Express Cobalt" matching "American Express Cobalt Card".
 */
function matchScore(cardRaw: string, ...candidates: (string | undefined)[]): number {
  const rawTokens = tokenize(cardRaw);
  if (rawTokens.length === 0) return 0;
  let best = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const candTokens = tokenize(candidate);
    if (candTokens.length === 0) continue;
    // Bidirectional overlap: how many raw tokens appear in the candidate AND
    // how many candidate tokens appear in the raw. Take the better ratio.
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

/** Threshold above which we consider the match good enough to pre-select. */
const AUTO_SUGGEST_THRESHOLD = 0.6;

export function UnmappedCardPicker({
  cardRaw,
  cards,
}: {
  cardRaw: string;
  cards: Card[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Sort cards by match quality and identify the best suggestion
  const { sorted, bestMatch } = useMemo(() => {
    const scored = cards.map((c) => ({
      card: c,
      score: matchScore(cardRaw, c.nickname, c.officialName, c.contractCardId.replace(/-/g, " ")),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    return {
      sorted: scored.map((s) => s.card),
      bestMatch: top && top.score >= AUTO_SUGGEST_THRESHOLD ? top.card : null,
    };
  }, [cardRaw, cards]);

  function handleSelect(contractCardId: string) {
    startTransition(async () => {
      await mapWalletCard({ rawString: cardRaw, contractCardId });
      setExpanded(false);
    });
  }

  if (cards.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <CreditCard className="size-3" />
        <span className="truncate max-w-[140px]" title={cardRaw}>{cardRaw}</span>
      </span>
    );
  }

  // When there's a strong match, show a one-click confirm instead of forcing
  // the user through a dropdown.
  if (!expanded && bestMatch) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CreditCard className="size-3 text-amber-500 shrink-0" />
        <span className="truncate max-w-[120px] text-amber-600 dark:text-amber-400" title={cardRaw}>
          {cardRaw}
        </span>
        <span className="text-muted-foreground/60">→</span>
        {isPending ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : (
          <button
            type="button"
            onClick={() => handleSelect(bestMatch.contractCardId)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer font-medium"
            title={`Map "${cardRaw}" to ${bestMatch.nickname}`}
          >
            <Check className="size-3 shrink-0" />
            <span className="truncate max-w-[100px]">{bestMatch.nickname}</span>
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

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer"
        title={`Map "${cardRaw}" to one of your cards`}
      >
        <CreditCard className="size-3 shrink-0" />
        <span className="truncate max-w-[140px]">{cardRaw}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <CreditCard className="size-3 text-amber-500 shrink-0" />
      {isPending ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <select
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="rounded-md border border-input bg-background px-1.5 py-0.5 text-xs text-foreground shadow-xs focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition max-w-[180px]"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) handleSelect(e.target.value);
          }}
          onBlur={() => setExpanded(false)}
        >
          <option value="" disabled>
            Pick card…
          </option>
          {sorted.map((c) => (
            <option key={c.contractCardId} value={c.contractCardId}>
              {c.nickname}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
