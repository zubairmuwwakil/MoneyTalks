"use client";

import { Tag, Loader2 } from "lucide-react";
import { useTransition, useState } from "react";
import { setMerchantCategory } from "@/app/settings/merchants/actions";
import { CATEGORIES, getCategoryMeta } from "@/lib/categories";

export function InlineCategoryPicker({
  rawString,
  currentCategory,
  variant = "default",
}: {
  rawString: string;
  currentCategory?: string | null;
  variant?: "default" | "badge" | "compact";
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activeCategory, setActiveCategory] = useState<string | null>(currentCategory ?? null);

  function handleSelect(newCategory: string | null) {
    startTransition(async () => {
      const res = await setMerchantCategory({ rawString, category: newCategory });
      if (res.ok) {
        setActiveCategory(res.category);
        setExpanded(false);
      }
    });
  }

  const meta = getCategoryMeta(activeCategory);

  if (!expanded) {
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
          title={`Click to change category for "${rawString}" (currently: ${meta.label})`}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
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
          title={`Click to change category for "${rawString}"`}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
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
        title={`Click to change merchant category for "${rawString}"`}
      >
        <Tag className="size-3 text-primary" />
        <span>{activeCategory ? `${meta.icon} ${meta.label}` : "+ Add Category"}</span>
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
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition max-w-[200px]"
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
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
