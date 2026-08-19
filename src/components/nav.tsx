"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth, UserButton } from "@clerk/nextjs";
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
  ChevronDown,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

// Primary in-app visible navigation items
const primaryLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/bills", label: "Bills", icon: Receipt },
  { href: "/cards", label: "Cards", icon: CreditCard },
  { href: "/purchases", label: "Purchases", icon: ShoppingBag },
] as const;

// Secondary in-app items nested under the "More" dropdown
const secondaryLinks = [
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/returns", label: "Returns", icon: Undo2 },
  { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
  { href: "/receipts", label: "Receipts", icon: FileText },
  { href: "/money-finder", label: "Money Finder", icon: Sparkles },
] as const;

const publicLinks = [
  { href: "/marketing", label: "Features", icon: Sparkles },
  { href: "/waitlist", label: "Waitlist", icon: UserPlus },
  { href: "/privacy", label: "Privacy", icon: Shield },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLLIElement>(null);

  const isPublicPage =
    pathname.startsWith("/marketing") ||
    pathname.startsWith("/waitlist") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/login");

  const isSecondaryActive = secondaryLinks.some((l) => pathname.startsWith(l.href));

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  function triggerCommandPalette() {
    window.dispatchEvent(new CustomEvent("open-command-palette"));
  }

  return (
    <>
      {/* Mobile Top Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md sm:hidden">
        <Link href={isSignedIn ? "/" : "/marketing"} className="flex items-center gap-2 font-bold tracking-tight">
          <div className="flex size-7 items-center justify-center rounded-lg bg-foreground/10 text-foreground overflow-hidden">
            <Image src="/icon.svg" alt="Inunity" width={20} height={20} className="size-5" />
          </div>
          <span className="text-sm font-bold tracking-tight">Inunity</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={triggerCommandPalette}
            className="flex size-8 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Search"
          >
            <Search className="size-4" />
          </button>
          <ThemeToggle />
          {isSignedIn ? (
            <>
              {!isPublicPage && (
                <Link
                  href="/notifications"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    pathname.startsWith("/notifications") && "bg-secondary text-foreground"
                  )}
                  aria-label="Notifications"
                >
                  <Bell className="size-4" />
                </Link>
              )}
              {isPublicPage ? (
                <Link
                  href="/"
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-xs font-medium text-background shadow-2xs"
                >
                  <span>Dashboard</span>
                  <ArrowRight className="size-3" />
                </Link>
              ) : null}
              <UserButton />
            </>
          ) : (
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
        </div>
      </header>

      {/* Desktop Top Header & Navigation */}
      <header className="sticky top-0 z-30 hidden border-b border-border/70 bg-background/90 backdrop-blur-md sm:block">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link
              href={isSignedIn ? "/" : "/marketing"}
              className="flex items-center gap-2.5 font-bold tracking-tight transition-opacity hover:opacity-90"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-foreground/10 text-foreground shadow-xs overflow-hidden">
                <Image src="/icon.svg" alt="Inunity" width={24} height={24} className="size-6" />
              </div>
              <span className="text-base font-semibold tracking-tight">Inunity</span>
            </Link>

            {/* Navigation Switcher: Public Route Header vs In-App Authenticated Header */}
            {isPublicPage ? (
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
            ) : isSignedIn ? (
              <nav aria-label="Main Navigation">
                <ul className="flex items-center gap-1">
                  {primaryLinks.map(({ href, label, icon: Icon }) => {
                    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all duration-150 whitespace-nowrap",
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

                  {/* Secondary items "More" dropdown */}
                  <li className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setDropdownOpen((prev) => !prev)}
                      className={cn(
                        "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all duration-150 cursor-pointer",
                        isSecondaryActive || dropdownOpen
                          ? "bg-secondary text-foreground font-semibold shadow-2xs"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                      aria-expanded={dropdownOpen}
                      aria-haspopup="true"
                    >
                      <MoreHorizontal className="size-4" />
                      <span>More</span>
                      <ChevronDown
                        className={cn("size-3.5 transition-transform duration-150", dropdownOpen && "rotate-180")}
                      />
                    </button>

                    {dropdownOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-48 rounded-xl border border-border/80 bg-popover p-1.5 shadow-lg backdrop-blur-md z-50 animate-in fade-in-50 zoom-in-95">
                        {secondaryLinks.map(({ href, label, icon: Icon }) => {
                          const active = pathname.startsWith(href);
                          return (
                            <Link
                              key={href}
                              href={href}
                              onClick={() => setDropdownOpen(false)}
                              className={cn(
                                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                                active
                                  ? "bg-secondary text-foreground font-semibold"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                              )}
                            >
                              <Icon className={cn("size-4", active ? "text-foreground" : "text-muted-foreground")} />
                              <span>{label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </li>
                </ul>
              </nav>
            ) : null}
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2.5">
            {/* Quick Search Palette Trigger */}
            <button
              type="button"
              onClick={triggerCommandPalette}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-2xs transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
              title="Search & Quick Actions (⌘K)"
            >
              <Search className="size-3.5" />
              <span className="hidden md:inline">Quick Jump</span>
              <kbd className="hidden md:inline-block rounded border border-border/80 bg-background px-1 py-0.2 text-[9px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </button>

            {/* Light / Dark Mode Toggle */}
            <ThemeToggle />

            {isPublicPage ? (
              isSignedIn ? (
                <div className="flex items-center gap-2.5">
                  <Link
                    href="/"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-semibold text-background shadow-2xs transition-all hover:bg-foreground/90"
                  >
                    <span>Dashboard</span>
                    <ArrowRight className="size-3" />
                  </Link>
                  <UserButton />
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <Link
                    href="/login"
                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/waitlist"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-semibold text-background shadow-2xs transition-all hover:bg-foreground/90"
                  >
                    <span>Join Waitlist</span>
                    <ArrowRight className="size-3" />
                  </Link>
                </div>
              )
            ) : isSignedIn ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/notifications"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    pathname.startsWith("/notifications") && "bg-secondary text-foreground font-semibold"
                  )}
                  title="Notifications"
                >
                  <Bell className="size-4" />
                </Link>
                <Link
                  href="/settings"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    pathname.startsWith("/settings") && "bg-secondary text-foreground font-semibold"
                  )}
                  title="Settings"
                >
                  <Settings className="size-4" />
                </Link>
                <div className="ml-0.5">
                  <UserButton />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        {isPublicPage ? (
          <ul className="flex h-14 items-stretch justify-around px-1">
            <li className="flex flex-1 items-stretch">
              <Link
                href="/marketing"
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors",
                  pathname.startsWith("/marketing")
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
                  pathname.startsWith("/waitlist")
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
                  pathname.startsWith("/privacy")
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Shield className="size-4" />
                <span className="text-[10px] leading-none tracking-tight">Privacy</span>
              </Link>
            </li>
            <li className="flex flex-1 items-stretch">
              {isSignedIn ? (
                <Link
                  href="/"
                  className="flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center font-semibold text-foreground"
                >
                  <LayoutDashboard className="size-4" />
                  <span className="text-[10px] leading-none tracking-tight">Hub</span>
                </Link>
              ) : (
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
              )}
            </li>
          </ul>
        ) : isSignedIn ? (
          <>
            <ul className="flex h-14 items-stretch justify-around px-1">
              {primaryLinks.slice(0, 4).map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <li key={href} className="flex flex-1 items-stretch">
                    <Link
                      href={href}
                      className={cn(
                        "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors",
                        active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className={cn("flex size-6 items-center justify-center rounded-md", active && "bg-secondary")}>
                        <Icon className={cn("size-3.5", active ? "text-foreground" : "text-muted-foreground")} />
                      </div>
                      <span className="text-[10px] leading-none tracking-tight">{label}</span>
                    </Link>
                  </li>
                );
              })}
              <li className="flex flex-1 items-stretch">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen((prev) => !prev)}
                  className={cn(
                    "flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center transition-colors cursor-pointer",
                    mobileMenuOpen || isSecondaryActive || pathname.startsWith("/purchases") || pathname.startsWith("/settings")
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className={cn("flex size-6 items-center justify-center rounded-md", (mobileMenuOpen || isSecondaryActive) && "bg-secondary")}>
                    <MoreHorizontal className="size-3.5" />
                  </div>
                  <span className="text-[10px] leading-none tracking-tight">More</span>
                </button>
              </li>
            </ul>

            {/* Mobile "More" Drawer / Overlay */}
            {mobileMenuOpen && (
              <div className="fixed inset-x-0 bottom-14 z-50 border-t border-border/80 bg-background/98 p-4 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-2">
                <div className="flex items-center justify-between pb-3 border-b border-border/60">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">More Tools &amp; Settings</span>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-3">
                  <Link
                    href="/purchases"
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border border-border/60 p-2.5 text-xs font-medium",
                      pathname.startsWith("/purchases") ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <ShoppingBag className="size-4 text-primary" />
                    <span>Purchases</span>
                  </Link>
                  {secondaryLinks.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border border-border/60 p-2.5 text-xs font-medium",
                        pathname.startsWith(href) ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className="size-4 text-primary" />
                      <span>{label}</span>
                    </Link>
                  ))}
                  <Link
                    href="/settings"
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border border-border/60 p-2.5 text-xs font-medium",
                      pathname.startsWith("/settings") ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <Settings className="size-4 text-primary" />
                    <span>Settings</span>
                  </Link>
                </div>
              </div>
            )}
          </>
        ) : null}
      </nav>
    </>
  );
}
