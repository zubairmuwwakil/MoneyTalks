export interface CategoryDefinition {
  id: string;
  label: string;
  icon: string;
  badgeClass: string;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: "dining",
    label: "Dining & Delivery",
    icon: "🍔",
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  },
  {
    id: "groceries",
    label: "Groceries",
    icon: "🛒",
    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  },
  {
    id: "gas",
    label: "Gas & EV",
    icon: "⛽",
    badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  },
  {
    id: "transit",
    label: "Transit & Rideshare",
    icon: "🚇",
    badgeClass: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20",
  },
  {
    id: "bills",
    label: "Bills & Utilities",
    icon: "⚡",
    badgeClass: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20",
  },
  {
    id: "drugstore",
    label: "Drugstore & Health",
    icon: "💊",
    badgeClass: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
  },
  {
    id: "travel",
    label: "Travel & Flights",
    icon: "✈️",
    badgeClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
  },
  {
    id: "hotel",
    label: "Hotels & Stays",
    icon: "🏨",
    badgeClass: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
  },
  {
    id: "entertainment",
    label: "Entertainment",
    icon: "🎬",
    badgeClass: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20",
  },
  {
    id: "streaming",
    label: "Streaming & Subs",
    icon: "🍿",
    badgeClass: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20",
  },
  {
    id: "shopping",
    label: "Shopping & Retail",
    icon: "🛍️",
    badgeClass: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20",
  },
  {
    id: "warehouse",
    label: "Warehouse Clubs",
    icon: "📦",
    badgeClass: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20",
  },
  {
    id: "home_improvement",
    label: "Home Improvement",
    icon: "🔨",
    badgeClass: "bg-amber-600/10 text-amber-800 dark:text-amber-200 border-amber-600/20",
  },
  {
    id: "online_foreign",
    label: "Foreign Online",
    icon: "🌐",
    badgeClass: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
  },
  {
    id: "other",
    label: "Other",
    icon: "🏷️",
    badgeClass: "bg-muted text-muted-foreground border-border/60",
  },
];

const CATEGORY_MAP = new Map<string, CategoryDefinition>(
  CATEGORIES.map((cat) => [cat.id, cat])
);

const ALIAS_MAP: Record<string, string> = {
  grocery: "groceries",
  groceries: "groceries",
  gasstation: "gas",
  gas_station: "gas",
  gas: "gas",
  recurringbill: "bills",
  recurringbills: "bills",
  recurring_bill: "bills",
  recurring_bills: "bills",
  utilities: "bills",
  utility: "bills",
  bills: "bills",
  pharmacy: "drugstore",
  drugstore: "drugstore",
  lodging: "hotel",
  hotel: "hotel",
  hotels: "hotel",
  flight: "travel",
  flights: "travel",
  travel: "travel",
  digitalmedia: "streaming",
  digital_media: "streaming",
  streaming: "streaming",
  retail: "shopping",
  general_retail: "shopping",
  shopping: "shopping",
  everythingelse: "other",
  everything_else: "other",
  unknown: "other",
  other: "other",
};

/**
 * Normalizes any category string or alias to a canonical category ID.
 */
export function normalizeCategoryId(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (ALIAS_MAP[cleaned]) {
    return ALIAS_MAP[cleaned];
  }
  if (CATEGORY_MAP.has(cleaned)) {
    return cleaned;
  }
  return cleaned;
}

/**
 * Gets the metadata (label, icon, styling) for a given category.
 */
export function getCategoryMeta(category?: string | null): CategoryDefinition {
  if (!category || category === "uncategorized") {
    return {
      id: "uncategorized",
      label: "Uncategorized",
      icon: "❓",
      badgeClass: "bg-muted/60 text-muted-foreground border-border/40",
    };
  }

  const normalized = normalizeCategoryId(category);
  if (normalized && CATEGORY_MAP.has(normalized)) {
    return CATEGORY_MAP.get(normalized)!;
  }

  // Fallback for custom or unmapped categories
  const formattedLabel = category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: category,
    label: formattedLabel,
    icon: "🏷️",
    badgeClass: "bg-muted text-foreground border-border/60",
  };
}
