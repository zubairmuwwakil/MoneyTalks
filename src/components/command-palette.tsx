"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  TrendingUp,
  Receipt,
  CreditCard,
  ShoppingBag,
  Undo2,
  Repeat,
  FileText,
  CalendarDays,
  Sparkles,
  Settings,
  Bell,
  PlusCircle,
  UploadCloud,
  Shield,
  UserPlus,
  X,
  CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  title: string;
  description: string;
  category: "Navigation" | "Quick Actions" | "Public & Info";
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
}

const COMMANDS: CommandItem[] = [
  // Quick Actions
  {
    id: "act-add-card",
    title: "Add Credit Card",
    description: "Add a new card to your wallet and configure category multipliers",
    category: "Quick Actions",
    href: "/cards/new",
    icon: PlusCircle,
    keywords: ["card", "wallet", "rewards", "add", "multiplier", "cobalt", "amex", "visa"],
  },
  {
    id: "act-upload-receipt",
    title: "Upload Purchase Receipt",
    description: "Parse an itemized receipt image or PDF to start a return window",
    category: "Quick Actions",
    href: "/receipts/upload",
    icon: UploadCloud,
    keywords: ["receipt", "upload", "scan", "return", "invoice", "pdf", "image"],
  },
  {
    id: "act-record-bill",
    title: "Record Upcoming Bill",
    description: "Create a recurring bill schedule or cadence forecast",
    category: "Quick Actions",
    href: "/bills/new",
    icon: PlusCircle,
    keywords: ["bill", "expense", "recurring", "schedule", "rent", "utilities"],
  },
  {
    id: "act-import-account",
    title: "Import Account / CSV Data",
    description: "Import financial transactions or balance history from CSV",
    category: "Quick Actions",
    href: "/investments/import",
    icon: UploadCloud,
    keywords: ["import", "csv", "questrade", "wealthsimple", "bank", "transactions"],
  },
  {
    id: "act-reconcile-cards",
    title: "Reconcile Card Statement",
    description: "Match statement balances against ingested transactions",
    category: "Quick Actions",
    href: "/cards/reconcile",
    icon: CreditCard,
    keywords: ["reconcile", "statement", "match", "balance", "audit"],
  },

  // Navigation
  {
    id: "nav-dashboard",
    title: "Dashboard Overview",
    description: "View multi-currency net worth, active alerts, and 14-day upcoming cashflow",
    category: "Navigation",
    href: "/",
    icon: LayoutDashboard,
    keywords: ["dashboard", "home", "net worth", "balances", "cash cushion"],
  },
  {
    id: "nav-investments",
    title: "Investments & Accounts",
    description: "View investment portfolios, asset valuations, and currency balances",
    category: "Navigation",
    href: "/investments",
    icon: TrendingUp,
    keywords: ["investments", "stocks", "etf", "crypto", "cad", "usd", "jmd", "holdings"],
  },
  {
    id: "nav-bills",
    title: "Bills & Cashflow Forecast",
    description: "12-month expense projections, pile-up warnings, and bill payment history",
    category: "Navigation",
    href: "/bills",
    icon: Receipt,
    keywords: ["bills", "forecast", "cashflow", "timeline", "danger month", "expenses"],
  },
  {
    id: "nav-cards",
    title: "Cards & Copilot Multipliers",
    description: "Wallet card catalogue, category spend caps, and annual fee ROI verdicts",
    category: "Navigation",
    href: "/cards",
    icon: CreditCard,
    keywords: ["cards", "copilot", "multipliers", "groceries", "dining", "travel", "fees"],
  },
  {
    id: "nav-purchases",
    title: "Purchases & Merged Items",
    description: "Cross-source purchase feed, receipt attachments, and transaction history",
    category: "Navigation",
    href: "/purchases",
    icon: ShoppingBag,
    keywords: ["purchases", "transactions", "orders", "merchants", "history"],
  },
  {
    id: "nav-returns",
    title: "Returns Catch-Net",
    description: "Track return deadlines, merchant refund statuses, and credit arrivals",
    category: "Navigation",
    href: "/returns",
    icon: Undo2,
    keywords: ["returns", "refunds", "deadline", "policy", "amazon", "apple"],
  },
  {
    id: "nav-subscriptions",
    title: "Subscriptions & Cadence",
    description: "Review recurring SaaS, memberships, renewal cycles, and cancellation deadlines",
    category: "Navigation",
    href: "/subscriptions",
    icon: Repeat,
    keywords: ["subscriptions", "recurring", "saas", "netflix", "spotify", "renewals"],
  },
  {
    id: "nav-receipts",
    title: "Receipts Ingestion Hub",
    description: "Search extracted line items, merchant tax breakdowns, and original scans",
    category: "Navigation",
    href: "/receipts",
    icon: FileText,
    keywords: ["receipts", "inbox", "scans", "tax", "ocr", "line items"],
  },
  {
    id: "nav-calendar",
    title: "Financial Calendar",
    description: "Monthly calendar view of bills, statement closes, and return windows",
    category: "Navigation",
    href: "/calendar",
    icon: CalendarDays,
    keywords: ["calendar", "dates", "schedule", "month", "events"],
  },
  {
    id: "nav-money-finder",
    title: "Money Finder & Tax Compliance",
    description: "24 cross-border filing rules (FBAR, 8938, PFIC, T1135) and grant opportunities",
    category: "Navigation",
    href: "/money-finder",
    icon: Sparkles,
    keywords: ["money finder", "tax", "fbar", "pfic", "t1135", "rdsp", "fhsa", "dtc", "grants"],
  },
  {
    id: "nav-settings",
    title: "Settings & Profile",
    description: "Wallet defaults, notifications, residency profile, and data export/delete",
    category: "Navigation",
    href: "/settings",
    icon: Settings,
    keywords: ["settings", "profile", "preferences", "export", "delete", "account"],
  },
  {
    id: "nav-notifications",
    title: "Notifications Center",
    description: "Review unread system alerts, return reminders, and fee cycle notifications",
    category: "Navigation",
    href: "/notifications",
    icon: Bell,
    keywords: ["notifications", "alerts", "inbox", "reminders"],
  },

  // Public & Info
  {
    id: "pub-signup",
    title: "Create Account / Sign Up",
    description: "Register a new In Unity account and start setting up your command center",
    category: "Public & Info",
    href: "/signup",
    icon: UserPlus,
    keywords: ["signup", "sign up", "register", "create account", "join", "new account"],
  },
  {
    id: "pub-features",
    title: "Features & Architecture",
    description: "Learn about offline ambient copilot logic and privacy by construction",
    category: "Public & Info",
    href: "/marketing",
    icon: Sparkles,
    keywords: ["marketing", "features", "how it works", "overview", "landing"],
  },
  {
    id: "pub-waitlist",
    title: "Early Access Waitlist",
    description: "Join the TestFlight iOS card copilot beta program",
    category: "Public & Info",
    href: "/waitlist",
    icon: UserPlus,
    keywords: ["waitlist", "beta", "testflight", "invite", "access"],
  },
  {
    id: "pub-privacy",
    title: "Privacy & Security Policy",
    description: "Our 100% no-banking-credentials zero-scraping security guarantees",
    category: "Public & Info",
    href: "/privacy",
    icon: Shield,
    keywords: ["privacy", "security", "encryption", "policy"],
  },
  {
    id: "pub-terms",
    title: "Terms of Service",
    description: "Terms and conditions, disclaimers, and platform governing rules",
    category: "Public & Info",
    href: "/terms",
    icon: FileText,
    keywords: ["terms", "tos", "terms of service", "conditions", "legal", "rules", "disclaimer"],
  },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();

  // Keyboard shortcut listener (Cmd+K or Ctrl+K)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    function handleCustomOpen() {
      setOpen(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-command-palette", handleCustomOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-command-palette", handleCustomOpen);
    };
  }, []);

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query.trim()) return COMMANDS;
    const lower = query.toLowerCase().trim();
    return COMMANDS.filter((cmd) => {
      return (
        cmd.title.toLowerCase().includes(lower) ||
        cmd.description.toLowerCase().includes(lower) ||
        cmd.category.toLowerCase().includes(lower) ||
        cmd.keywords.some((k) => k.toLowerCase().includes(lower))
      );
    });
  }, [query]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  function navigateTo(item: CommandItem) {
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      navigateTo(filtered[selectedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[15vh] backdrop-blur-xs animate-in fade-in-0 duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-popover shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Search Bar Input */}
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <Search className="size-5 text-muted-foreground shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleListKeyDown}
            placeholder="Type a command, page, card, or tool..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              No matching commands or pages found for &quot;{query}&quot;.
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-secondary text-foreground shadow-2xs font-medium"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70",
                          isSelected ? "bg-background text-foreground shadow-xs" : "bg-muted/40 text-muted-foreground"
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-foreground truncate">{item.title}</p>
                          <span className="rounded-md bg-muted px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground">
                            {item.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{item.description}</p>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground shrink-0 pl-2">
                        <span>Go</span>
                        <CornerDownLeft className="size-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
            <span>esc to close</span>
          </div>
          <span className="font-semibold text-foreground/80">In Unity Command Surface</span>
        </div>
      </div>
    </div>
  );
}
