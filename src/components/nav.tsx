"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Coins,
  CreditCard,
  Bell,
  LayoutDashboard,
  Receipt,
  ShoppingBag,
  Undo2,
  Repeat,
  FileText,
  Settings,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/bills", label: "Bills", icon: Receipt },
  { href: "/cards", label: "Cards", icon: CreditCard },
  { href: "/purchases", label: "Purchases", icon: ShoppingBag },
  { href: "/returns", label: "Returns", icon: Undo2 },
  { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
  { href: "/receipts", label: "Receipts", icon: FileText },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/money-finder", label: "Money Finder", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile Top Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md sm:hidden">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <Coins className="size-4.5" />
          </div>
          <span className="text-base font-semibold">MoneyTalks</span>
        </Link>
      </header>

      {/* Desktop Top Header & Navigation */}
      <header className="sticky top-0 z-30 hidden border-b border-border/70 bg-background/90 backdrop-blur-md sm:block">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight transition-opacity hover:opacity-90">
              <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background shadow-xs">
                <Coins className="size-4.5" />
              </div>
              <span className="text-base font-semibold tracking-tight">MoneyTalks</span>
            </Link>

            <nav aria-label="Main Navigation">
              <ul className="flex items-center gap-1">
                {links.map(({ href, label, icon: Icon }) => {
                  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150",
                          active
                            ? "bg-secondary text-foreground font-semibold shadow-2xs"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                      >
                        <Icon className={cn("size-4", active ? "text-foreground" : "text-muted-foreground")} />
                        <span>{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        <ul className="flex h-15 items-stretch justify-around px-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href} className="flex flex-1 items-stretch">
                <Link
                  href={href}
                  className={cn(
                    "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors",
                    active
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className={cn("flex size-7 items-center justify-center rounded-md transition-colors", active ? "bg-secondary" : "")}>
                    <Icon className={cn("size-4", active ? "text-foreground" : "text-muted-foreground")} />
                  </div>
                  <span className="text-[10px] leading-none tracking-tight">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
