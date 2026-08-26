"use client";

import { Tag, Loader2, Sparkles } from "lucide-react";
import { useTransition, useState } from "react";
import { setMerchantCategory } from "@/app/settings/merchants/actions";
import { CATEGORIES, getCategoryMeta } from "@/lib/categories";

/**
 * Sources that are an OWNER decision. Everything else is the app's reading of
 * the evidence and is marked as such, so "you said" and "we worked it out"
 * never look identical on the row.
 */
const OWNER_SOURCES = new Set(["userOverride", "merchantAlias"]);

const SOURCE_EXPLANATION: Record<string, string> = {
  userOverride: "You set this category.",
  merchantAlias: "Saved from a previous purchase at this merchant.",
  observedMcc: "The card network coded this purchase into this category.",
  emailDomain: "Matched the receipt's sender domain.",
  brandPack: "Matched a known merchant in the merchant pack.",
  mccTable: "Read from the merchant's usual category code.",
  processorPrior: "Inferred from the payment processor.",
};

export function InlineCategoryPicker({
  rawString,
  currentCategory,
  categorySource,
  suggestion,
  variant = "default",
}: {
  rawString: string;
  currentCategory?: string | null;
  /** Which resolver tier decided `currentCategory`. Null for older rows. */
  categorySource?: string | null;
  /**
   * A resolution too weak to auto-apply, offered as one tap. Present only
   * when the purchase has no category at all.
   */
  suggestion?: { category: string; rationale: string } | null;
  variant?: "default" | "badge" | "compact";
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activeCategory, setActiveCategory] = useState<string | null>(currentCategory ?? null);
  // A confirmed suggestion becomes an owner decision — that is exactly what
  // tapping it means — so the provenance marker disappears with the tap.
  const [activeSource, setActiveSource] = useState<string | null>(categorySource ?? null);

  function handleSelect(newCategory: string | null) {
    startTransition(async () => {
      const res = await setMerchantCategory({ rawString, category: newCategory });
      if (res.ok) {
        setActiveCategory(res.category);
        setActiveSource(res.category ? "userOverride" : null);
        setExpanded(false);
      }
    });
  }

  const meta = getCategoryMeta(activeCategory);
  const isDerived = Boolean(activeCategory) && activeSource != null && !OWNER_SOURCES.has(activeSource);
  const sourceNote = activeSource ? SOURCE_EXPLANATION[activeSource] : null;

  if (!expanded) {
    // Nothing categorized this, but a weak tier had a reading. One tap
    // confirms it and trains the alias for every future purchase here.
    if (!activeCategory && suggestion) {
      const suggested = getCategoryMeta(suggestion.category);
      return (
        <button
          type="button"
          disabled={isPending}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSelect(suggestion.category);
          }}
          title={`${suggestion.rationale} Tap to confirm — this trains "${rawString}" for every future purchase.`}
          className="group inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-all hover:bg-primary/20 hover:scale-105 disabled:opacity-60 cursor-pointer"
        >
          {isPending ? (
            <Loader2 className="size-2.5 animate-spin" />
          ) : (
            <Sparkles className="size-2.5" />
          )}
          <span>{suggested.icon} {suggested.label}?</span>
        </button>
      );
    }

    const provenanceTitle = sourceNote
      ? `${meta.label} — ${sourceNote} Click to change.`
      : `Click to change category for "${rawString}" (currently: ${meta.label})`;

    if (variant === "badge") {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(true);
          }}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all hover:scale-105 cursor-pointer ${meta.badgeClass}`}
          title={provenanceTitle}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
          {isDerived ? <Sparkles className="size-2.5 opacity-60" aria-label="Categorized automatically" /> : null}
        </button>
      );
    }

    if (variant === "compact") {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(true);
          }}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title={provenanceTitle}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
          {isDerived ? <Sparkles className="size-2.5 opacity-60" aria-label="Categorized automatically" /> : null}
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded(true);
        }}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border/60"
        title={provenanceTitle}
      >
        <Tag className="size-3 text-primary" />
        <span>{activeCategory ? `${meta.icon} ${meta.label}` : "+ Add Category"}</span>
        {isDerived ? <Sparkles className="size-2.5 opacity-60" aria-label="Categorized automatically" /> : null}
      </button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {isPending ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <select
          autoFocus
          className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition max-w-[220px]"
          defaultValue={activeCategory ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            handleSelect(val === "" ? null : val);
          }}
          onBlur={() => setExpanded(false)}
        >
          <option value="">❓ Uncategorized</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.label}
              {c.scorable ? "" : " (no bonus rate)"}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
