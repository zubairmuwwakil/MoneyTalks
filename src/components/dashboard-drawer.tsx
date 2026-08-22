"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  Wallet,
  Receipt,
  Sparkles,
  Plus,
  CreditCard,
  UploadCloud,
  Calendar,
  ArrowRight,
  ChevronRight,
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCircle2,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { cn } from "@/lib/utils";

export interface DrawerAccountItem {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  currency?: Currency;
  balanceMinor?: number;
  displayMinor?: number;
  ok: boolean;
  error?: string;
}

export interface DrawerBillItem {
  billId: string;
  billName: string;
  date: string;
  amountMinor: number;
  currency: string;
  autopay: boolean;
  paid: boolean;
}

export interface DrawerAlertItem {
  ruleKey: string;
  entityRef: string;
  title: string;
  action: string;
  severity: "critical" | "warning" | "info";
}

interface DashboardDrawerProps {
  accounts: DrawerAccountItem[];
  upcoming: DrawerBillItem[];
  alerts: DrawerAlertItem[];
  display: Currency;
}

type DrawerTab = "actions" | "accounts" | "bills" | "alerts";

export function DashboardPulseBarAndDrawer({
  accounts,
  upcoming,
  alerts,
  display,
}: DashboardDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("accounts");

  function openToTab(tab: DrawerTab) {
    setActiveTab(tab);
    setIsOpen(true);
  }

  // Keyboard shortcut listener (Escape to close)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const hasCriticalAlerts = alerts.some((a) => a.severity === "critical");
  const hasWarningAlerts = alerts.some((a) => a.severity === "warning");

  return (
    <>
      {/* Pulse Bar Trigger Row */}
      <section
        aria-label="Dashboard pulse and shortcuts"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-border/80 bg-muted/20 p-2 sm:p-2.5 backdrop-blur-xs"
      >
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Quick Actions Trigger */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openToTab("actions")}
            className="h-8 gap-1.5 rounded-xl border-border/80 bg-background px-3 text-xs font-semibold shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/60 cursor-pointer"
          >
            <Plus className="size-3.5 text-primary" />
            <span>Quick Actions</span>
          </Button>

          {/* Accounts Breakdown Trigger */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => openToTab("accounts")}
            className="h-8 gap-1.5 rounded-xl border border-border/60 bg-background/70 px-3 text-xs font-medium text-muted-foreground shadow-2xs transition-all hover:bg-muted/80 hover:text-foreground cursor-pointer"
          >
            <Wallet className="size-3.5 text-muted-foreground" />
            <span>
              <strong className="text-foreground font-semibold">{accounts.length}</strong> Accounts
            </span>
          </Button>

          {/* Upcoming Bills Trigger */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => openToTab("bills")}
            className="h-8 gap-1.5 rounded-xl border border-border/60 bg-background/70 px-3 text-xs font-medium text-muted-foreground shadow-2xs transition-all hover:bg-muted/80 hover:text-foreground cursor-pointer"
          >
            <Calendar className="size-3.5 text-muted-foreground" />
            <span>
              <strong className="text-foreground font-semibold">{upcoming.length}</strong> Next 14 Days
            </span>
          </Button>

          {/* Alerts Trigger */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => openToTab("alerts")}
            className={cn(
              "h-8 gap-1.5 rounded-xl border border-border/60 bg-background/70 px-3 text-xs font-medium shadow-2xs transition-all hover:bg-muted/80 cursor-pointer",
              alerts.length > 0 && hasCriticalAlerts
                ? "border-red-500/30 text-red-600 dark:text-red-400 font-semibold"
                : alerts.length > 0 && hasWarningAlerts
                ? "border-amber-500/30 text-amber-600 dark:text-amber-400 font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="size-3.5" />
            <span>
              <strong className="font-semibold">{alerts.length}</strong> {alerts.length === 1 ? "Alert" : "Alerts"}
            </span>
          </Button>
        </div>

        {/* Slide-over expander button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openToTab(activeTab)}
          className="h-8 gap-1 rounded-xl border-border/80 bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          title="Open Overview Hub"
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden sm:inline">Overview Hub</span>
        </Button>
      </section>

      {/* Slide-Over Drawer Modal & Backdrop */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Dashboard Overview Hub"
          className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-background/70 backdrop-blur-sm transition-opacity"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Slide-out Panel */}
          <div className="relative z-50 flex h-full w-full max-w-lg flex-col border-l border-border/80 bg-background p-0 shadow-2xl animate-in slide-in-from-right duration-250 sm:max-w-xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-border/80 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">Overview Hub</h2>
                <p className="text-xs text-muted-foreground">Detailed breakdowns and quick actions</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="size-8 rounded-lg p-0 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                aria-label="Close drawer"
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-border/60 bg-muted/20 px-6 py-2 overflow-x-auto gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("actions")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                  activeTab === "actions"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Plus className="size-3.5" />
                <span>Quick Actions</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("accounts")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                  activeTab === "accounts"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Wallet className="size-3.5" />
                <span>Accounts ({accounts.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("bills")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                  activeTab === "bills"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Calendar className="size-3.5" />
                <span>Next 14 Days ({upcoming.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("alerts")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                  activeTab === "alerts"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sparkles className="size-3.5" />
                <span>Alerts ({alerts.length})</span>
              </button>
            </div>

            {/* Drawer Body / Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* TAB 1: QUICK ACTIONS */}
              {activeTab === "actions" && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">Financial Actions</h3>
                    <p className="text-xs text-muted-foreground">
                      Fast entry points to log bills, add cards, and sync accounts.
                    </p>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Link
                      href="/cards/new"
                      onClick={() => setIsOpen(false)}
                      className="group flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/40 hover:shadow-xs"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <CreditCard className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground group-hover:text-primary">
                          + Add Card
                        </p>
                        <p className="text-[11px] text-muted-foreground">Wallet copilot &amp; perks</p>
                      </div>
                    </Link>

                    <Link
                      href="/receipts/upload"
                      onClick={() => setIsOpen(false)}
                      className="group flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/40 hover:shadow-xs"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <UploadCloud className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground group-hover:text-primary">
                          Upload Receipt
                        </p>
                        <p className="text-[11px] text-muted-foreground">Return window catch-net</p>
                      </div>
                    </Link>

                    <Link
                      href="/bills/new"
                      onClick={() => setIsOpen(false)}
                      className="group flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/40 hover:shadow-xs"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <Calendar className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground group-hover:text-primary">
                          + Record Bill
                        </p>
                        <p className="text-[11px] text-muted-foreground">12-month cashflow schedule</p>
                      </div>
                    </Link>

                    <Link
                      href="/investments/new"
                      onClick={() => setIsOpen(false)}
                      className="group flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/40 hover:shadow-xs"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <Wallet className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground group-hover:text-primary">
                          + Add Account
                        </p>
                        <p className="text-[11px] text-muted-foreground">Manual &amp; native balances</p>
                      </div>
                    </Link>

                    <Link
                      href="/investments/import"
                      onClick={() => setIsOpen(false)}
                      className="group flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/40 hover:shadow-xs"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <Receipt className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground group-hover:text-primary">
                          Import CSV / Rates
                        </p>
                        <p className="text-[11px] text-muted-foreground">Bulk snapshots &amp; FX</p>
                      </div>
                    </Link>

                    <Link
                      href="/money-finder"
                      onClick={() => setIsOpen(false)}
                      className="group flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/40 hover:shadow-xs"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <Sparkles className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground group-hover:text-primary">
                          Tax &amp; Rules
                        </p>
                        <p className="text-[11px] text-muted-foreground">24 compliance checks</p>
                      </div>
                    </Link>
                  </div>
                </div>
              )}

              {/* TAB 2: ACCOUNTS BREAKDOWN */}
              {activeTab === "accounts" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Accounts &amp; Balances</h3>
                      <p className="text-xs text-muted-foreground">
                        {accounts.length} {accounts.length === 1 ? "account" : "accounts"} configured
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href="/investments/import"
                        onClick={() => setIsOpen(false)}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                      >
                        Import
                      </Link>
                      <span className="text-muted-foreground/40">·</span>
                      <Link
                        href="/investments/new"
                        onClick={() => setIsOpen(false)}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                      >
                        + Add account
                      </Link>
                    </div>
                  </div>

                  {accounts.length === 0 ? (
                    <Card className="border-dashed p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No accounts yet —{" "}
                        <Link
                          href="/investments/new"
                          onClick={() => setIsOpen(false)}
                          className="font-medium text-foreground underline"
                        >
                          add an account
                        </Link>{" "}
                        or{" "}
                        <Link
                          href="/investments/import"
                          onClick={() => setIsOpen(false)}
                          className="font-medium text-foreground underline"
                        >
                          import data
                        </Link>
                        .
                      </p>
                    </Card>
                  ) : (
                    <div className="space-y-2.5">
                      {accounts.map((a) => {
                        if (!a.ok) {
                          return (
                            <Link
                              key={a.id}
                              href={`/investments/${a.id}`}
                              onClick={() => setIsOpen(false)}
                              className="group flex flex-col justify-between rounded-xl border border-red-500/30 bg-red-500/5 p-3.5 shadow-2xs transition-all hover:border-red-500/50"
                            >
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-semibold text-foreground text-sm">{a.name}</p>
                                  <Badge variant="secondary" className="mt-1 text-[10px]">
                                    {a.type}
                                  </Badge>
                                </div>
                                <span className="text-xs text-red-600 font-medium">Snapshot needed →</span>
                              </div>
                              <p className="mt-2 text-xs text-red-600">{a.error}</p>
                            </Link>
                          );
                        }

                        const displayFormatted =
                          a.displayMinor !== undefined
                            ? formatMinorUnits(a.displayMinor, display)
                            : a.balanceMinor !== undefined && a.currency
                            ? formatMinorUnits(a.balanceMinor, a.currency)
                            : "—";

                        return (
                          <Link
                            key={a.id}
                            href={`/investments/${a.id}`}
                            onClick={() => setIsOpen(false)}
                            className="group flex items-center justify-between rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:bg-muted/30"
                          >
                            <div className="min-w-0 pr-3">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-sm text-foreground group-hover:text-primary truncate">
                                  {a.name}
                                </p>
                                <Badge variant="secondary" className="text-[10px] font-medium shrink-0">
                                  {a.type}
                                </Badge>
                              </div>
                              {a.currency && a.currency !== display && a.balanceMinor !== undefined && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  Native: {formatMinorUnits(a.balanceMinor, a.currency)} {a.currency}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold tabular-nums text-foreground">
                                {displayFormatted}
                              </span>
                              <ChevronRight className="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-2">
                    <Link
                      href="/investments"
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-muted/40 p-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <span>Go to Full Investments Module</span>
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </div>
              )}

              {/* TAB 3: UPCOMING BILLS */}
              {activeTab === "bills" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Next 14 Days Obligations</h3>
                      <p className="text-xs text-muted-foreground">Upcoming bills and credit card due dates</p>
                    </div>
                    <Link
                      href="/bills"
                      onClick={() => setIsOpen(false)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                    >
                      All bills
                    </Link>
                  </div>

                  {upcoming.length === 0 ? (
                    <Card className="border-dashed p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        Nothing due in the next 14 days.{" "}
                        <Link
                          href="/bills/new"
                          onClick={() => setIsOpen(false)}
                          className="font-medium text-foreground underline"
                        >
                          Add a recurring bill
                        </Link>
                        .
                      </p>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {upcoming.map((o) => (
                        <div
                          key={`${o.billId}:${o.date}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-2xs"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                              {o.date.slice(5)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-foreground">{o.billName}</p>
                              {o.autopay && (
                                <span className="text-[10px] text-emerald-600 font-medium">Autopay active</span>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground tabular-nums">
                            <span>
                              {o.amountMinor === 0
                                ? "—"
                                : formatMinorUnits(o.amountMinor, o.currency as Currency)}
                            </span>
                            {o.paid && <CheckCircle2 className="size-3.5 text-emerald-600" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2">
                    <Link
                      href="/bills/forecast"
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-muted/40 p-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <span>View 12-Month Bill Forecast</span>
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </div>
              )}

              {/* TAB 4: ALERTS & OPPORTUNITIES */}
              {activeTab === "alerts" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Alerts &amp; Opportunities</h3>
                      <p className="text-xs text-muted-foreground">Tax compliance and portfolio rules</p>
                    </div>
                    <Link
                      href="/money-finder"
                      onClick={() => setIsOpen(false)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                    >
                      All ({alerts.length})
                    </Link>
                  </div>

                  {alerts.length === 0 ? (
                    <Card className="border-dashed p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        All clear! No active compliance or tax rule alerts.
                      </p>
                    </Card>
                  ) : (
                    <div className="space-y-2.5">
                      {alerts.map((a) => (
                        <div
                          key={`${a.ruleKey}:${a.entityRef}`}
                          className="flex items-start gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs"
                        >
                          <div className="mt-0.5 shrink-0">
                            {a.severity === "critical" ? (
                              <ShieldAlert className="size-4 text-red-600" />
                            ) : a.severity === "warning" ? (
                              <AlertTriangle className="size-4 text-amber-600" />
                            ) : (
                              <Info className="size-4 text-sky-600" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="font-semibold text-xs text-foreground leading-snug">{a.title}</p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">{a.action}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2">
                    <Link
                      href="/money-finder"
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-muted/40 p-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <span>View All Compliance &amp; Tax Rules</span>
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="border-t border-border/80 bg-muted/20 px-6 py-3 text-center">
              <p className="text-[11px] text-muted-foreground">
                Tip: Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">Esc</kbd> anytime to close
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
