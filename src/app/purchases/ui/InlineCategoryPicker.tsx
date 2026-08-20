"use client";

import { Tag, Loader2, Check } from "lucide-react";
import { useTransition, useState } from "react";
import { setMerchantCategory } from "@/app/settings/merchants/actions";

const CATEGORIES = [
  { id: "dining", label: "🍔 Dining & Delivery" },
  { id: "grocery", label: "🛒 Groceries" },
  { id: "gas", label: "⛽ Gas & EV Charging" },
  { id: "transit", label: "🚇 Public Transit & Rideshare" },
  { id: "recurringBill", label: "⚡ Recurring Bills" },
  { id: "drugstore", label: "💊 Drugstore & Pharmacy" },
  { id: "travel", label: "✈️ Travel & Hotels" },
  { id: "entertainment", label: "🎬 Entertainment & Movies" },
  { id: "shopping", label: "🛍️ General Retail" },
];

export function InlineCategoryPicker({
  rawString,
  currentCategory,
}: {
  rawString: string;
  currentCategory?: string | null;
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

  const categoryObj = CATEGORIES.find((c) => c.id === activeCategory);
  const displayLabel = categoryObj ? categoryObj.label : activeCategory ? activeCategory : null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border/60"
        title={`Click to change merchant category for "${rawString}"`}
      >
        <Tag className="size-3 text-primary" />
        <span>{displayLabel ? displayLabel : "+ Add Category"}</span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Tag className="size-3 text-primary shrink-0" />
      {isPending ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <select
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition max-w-[200px]"
          defaultValue={activeCategory ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            handleSelect(val === "" ? null : val);
          }}
          onBlur={() => setExpanded(false)}
        >
          <option value="">Uncategorized</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
