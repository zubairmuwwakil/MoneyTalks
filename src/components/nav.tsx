"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  CreditCard,
  Bell,
  CalendarDays,
  LayoutDashboard,
  Receipt,
  ShoppingBag,
  Undo2,
  Repeat,
  FileText,
  Settings,
  Sparkles,
  TrendingUp,
  LogIn,
  UserPlus,
  Shield,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
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

const publicLinks = [
  { href: "/marketing", label: "Features", icon: Sparkles },
  { href: "/waitlist", label: "Waitlist", icon: UserPlus },
  { href: "/privacy", label: "Privacy", icon: Shield },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();

  return (
    <>
      {/* Mobile Top Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md sm:hidden">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <div className="flex size-8 items-center justify-center rounded-lg bg-foreground/10 text-foreground overflow-hidden">
            <img src="/icon.svg" alt="Inunity" className="size-6" />
          </div>
          <span className="text-base font-semibold">Inunity</span>
        </Link>
        {!isSignedIn && (
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/waitlist"
              className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-xs font-medium text-background"
            >
              <span>Beta</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>
        )}
      </header>

      {/* Desktop Top Header & Navigation */}
      <header className="sticky top-0 z-30 hidden border-b border-border/70 bg-background/90 backdrop-blur-md sm:block">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight transition-opacity hover:opacity-90">
              <div className="flex size-8 items-center justify-center rounded-lg bg-foreground/10 text-foreground shadow-xs overflow-hidden">
                <img src="/icon.svg" alt="Inunity" className="size-6" />
              </div>
              <span className="text-base font-semibold tracking-tight">Inunity</span>
            </Link>

            {isSignedIn ? (
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
            ) : (
              <nav aria-label="Public Navigation">
                <ul className="flex items-center gap-1">
                  {publicLinks.map(({ href, label, icon: Icon }) => {
                    const active = pathname.startsWith(href);
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
            )}
          </div>

          {!isSignedIn && (
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/waitlist"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-2xs transition-all hover:bg-foreground/90"
              >
                <span>Join Waitlist</span>
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        {isSignedIn ? (
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
        ) : (
          <ul className="flex h-15 items-stretch justify-around px-1">
            <li className="flex flex-1 items-stretch">
              <Link
                href="/marketing"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors",
                  pathname === "/marketing" || pathname === "/"
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sparkles className="size-4" />
                <span className="text-[10px] leading-none tracking-tight">Features</span>
              </Link>
            </li>
            <li className="flex flex-1 items-stretch">
              <Link
                href="/waitlist"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors",
                  pathname === "/waitlist"
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <UserPlus className="size-4" />
                <span className="text-[10px] leading-none tracking-tight">Waitlist</span>
              </Link>
            </li>
            <li className="flex flex-1 items-stretch">
              <Link
                href="/privacy"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors",
                  pathname === "/privacy"
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Shield className="size-4" />
                <span className="text-[10px] leading-none tracking-tight">Privacy</span>
              </Link>
            </li>
            <li className="flex flex-1 items-stretch">
              <Link
                href="/login"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors",
                  pathname.startsWith("/login")
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LogIn className="size-4" />
                <span className="text-[10px] leading-none tracking-tight">Sign In</span>
              </Link>
            </li>
          </ul>
        )}
      </nav>
    </>
  );
}
