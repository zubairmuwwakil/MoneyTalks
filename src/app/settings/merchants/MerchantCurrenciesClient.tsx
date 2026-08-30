"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  HelpCircle,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  UnresolvedCurrenciesSummary,
  UnresolvedMerchantItem,
} from "@/lib/domain/recurring/unresolvedMerchantCurrencies";
import { confirmMerchantCurrencyAction } from "./actions";

const POPULAR_CURRENCIES = ["CAD", "USD", "EUR", "GBP"] as const;

function formatCadence(cadence: Record<string, unknown> | null): string {
  if (!cadence) return "Cadence unknown";
  switch (cadence.type) {
    case "WEEKLY":
      return "Weekly";
    case "BIWEEKLY":
      return "Biweekly";
    case "MONTHLY":
      return typeof cadence.dayOfMonth === "number"
        ? `Monthly (~day ${cadence.dayOfMonth})`
        : "Monthly";
    case "QUARTERLY":
      return "Quarterly";
    case "SEMIANNUAL":
      return "Every 6 months";
    case "ANNUAL":
      return "Annual";
    default:
      return String(cadence.type || "Recurring");
  }
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MerchantCurrenciesClient({
  initialSummary,
}: {
  initialSummary: UnresolvedCurrenciesSummary;
}) {
  const [merchants, setMerchants] = useState<UnresolvedMerchantItem[]>(initialSummary.merchants);
  const [confirmedMerchants, setConfirmedMerchants] = useState(initialSummary.confirmedMerchants);
  const [filter, setFilter] = useState<"all" | "recurring" | "confirmed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currencyInputs, setCurrencyInputs] = useState<Record<string, string>>({});
  const [pendingMerchants, setPendingMerchants] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Record<string, { type: "success" | "error"; message: string }>>({});
  const [, startTransition] = useTransition();

  const handleCurrencySelect = (merchantId: string, code: string) => {
    setCurrencyInputs((prev) => ({ ...prev, [merchantId]: code.toUpperCase() }));
  };

  const handleSave = (merchantCanonicalId: string, explicitCurrency?: string) => {
    const currency = (explicitCurrency || currencyInputs[merchantCanonicalId] || "").trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      setFeedback((prev) => ({
        ...prev,
        [merchantCanonicalId]: {
          type: "error",
          message: "Please enter a valid 3-letter currency code (e.g. USD, CAD)",
        },
      }));
      return;
    }

    setPendingMerchants((prev) => new Set(prev).add(merchantCanonicalId));
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[merchantCanonicalId];
      return next;
    });

    startTransition(async () => {
      try {
        const result = await confirmMerchantCurrencyAction({
          merchantCanonicalId,
          currency,
        });

        if (result.ok) {
          setFeedback((prev) => ({
            ...prev,
            [merchantCanonicalId]: {
              type: "success",
              message: `Learned ${currency} for ${merchantCanonicalId} (${result.affectedPurchases} purchases updated)`,
            },
          }));

          // Update local state
          setMerchants((prev) =>
            prev.map((m) =>
              m.merchantCanonicalId === merchantCanonicalId
                ? { ...m, confirmedCurrency: currency }
                : m,
            ),
          );

          setConfirmedMerchants((prev) => {
            const filtered = prev.filter((c) => c.merchantCanonicalId !== merchantCanonicalId);
            return [
              {
                merchantCanonicalId,
                currency,
                updatedAt: new Date(),
              },
              ...filtered,
            ];
          });
        } else {
          setFeedback((prev) => ({
            ...prev,
            [merchantCanonicalId]: {
              type: "error",
              message: result.error || "Failed to update currency",
            },
          }));
        }
      } catch (err) {
        setFeedback((prev) => ({
          ...prev,
          [merchantCanonicalId]: {
            type: "error",
            message: err instanceof Error ? err.message : "An unexpected error occurred",
          },
        }));
      } finally {
        setPendingMerchants((prev) => {
          const next = new Set(prev);
          next.delete(merchantCanonicalId);
          return next;
        });
      }
    });
  };

  const filteredMerchants = merchants.filter((m) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      if (!m.merchantCanonicalId.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (filter === "recurring") return m.isRecurringCandidate;
    if (filter === "confirmed") return Boolean(m.confirmedCurrency);
    return true;
  });

  const recurringCandidatesCount = merchants.filter((m) => m.isRecurringCandidate).length;
  const unconfirmedCount = merchants.filter((m) => !m.confirmedCurrency).length;

  return (
    <div className="space-y-6">
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-border/70 bg-card shadow-2xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium">Unresolved Purchases</CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {initialSummary.totalUnresolvedPurchases}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Purchases waiting for billing currency
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card shadow-2xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium">Merchants to Review</CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {unconfirmedCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Across {merchants.length} total observed merchants
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-sky-500/5 border-sky-500/30 shadow-2xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-sky-700 dark:text-sky-300">
              Recurring Candidates Blocked
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-sky-900 dark:text-sky-100 flex items-center gap-2">
              <Sparkles className="size-5 text-sky-600 dark:text-sky-400" />
              {recurringCandidatesCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-sky-700 dark:text-sky-300">
              Regular subscriptions ready to be detected
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Explanation Banner */}
      <div className="rounded-2xl border border-border/80 bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed">
        <div className="flex items-start gap-2.5">
          <HelpCircle className="size-4 shrink-0 text-primary mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">
              How Merchant Billing Currencies Work
            </p>
            <p>
              Setting a currency for a merchant re-resolves all purchases from that merchant that have no explicit currency,
              and unlocks recurring subscription detection.
            </p>
            <p>
              <strong className="text-foreground">Provenance guarantee:</strong> Direct receipt evidence (e.g. stated &ldquo;CAD&rdquo; or &ldquo;USD&rdquo;) and manual purchase overrides are preserved and never overwritten.
            </p>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-muted/30 p-1">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              filter === "all"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Merchants ({merchants.length})
          </button>
          <button
            onClick={() => setFilter("recurring")}
            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              filter === "recurring"
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="size-3" />
            Recurring Candidates ({recurringCandidatesCount})
          </button>
          <button
            onClick={() => setFilter("confirmed")}
            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              filter === "confirmed"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Check className="size-3" />
            Confirmed ({confirmedMerchants.length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search merchants…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Merchant List */}
      <div className="space-y-3">
        {filteredMerchants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground">
            No merchants found matching the filter.
          </div>
        ) : (
          filteredMerchants.map((item, index) => {
            const isPending = pendingMerchants.has(item.merchantCanonicalId);
            const currentInput = currencyInputs[item.merchantCanonicalId] ?? item.confirmedCurrency ?? "";
            const currentFeedback = feedback[item.merchantCanonicalId];

            return (
              <Card
                key={item.merchantCanonicalId}
                className={`overflow-hidden border-border/70 transition-all ${
                  item.isRecurringCandidate
                    ? "border-sky-500/40 bg-card shadow-2xs hover:border-sky-500/60"
                    : "bg-card shadow-2xs"
                }`}
              >
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    {/* Left: Merchant Info */}
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">
                          #{index + 1}
                        </span>
                        <h3 className="text-base font-semibold text-foreground">
                          {item.merchantCanonicalId}
                        </h3>

                        {item.isRecurringCandidate ? (
                          <Badge variant="info" className="gap-1">
                            <Sparkles className="size-3 text-sky-600 dark:text-sky-400" />
                            Recurring Candidate · {formatCadence(item.candidateCadence as Record<string, unknown>)} ({item.candidateMatchedPurchases} charges)
                          </Badge>
                        ) : null}

                        {item.confirmedCurrency ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="size-3" />
                            Confirmed {item.confirmedCurrency}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {item.unresolvedPurchasesCount} purchase{item.unresolvedPurchasesCount === 1 ? "" : "s"} unblocked
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatDate(item.earliestPurchaseDate)} – {formatDate(item.latestPurchaseDate)}
                        </span>
                        {item.sampleDates.length > 0 ? (
                          <>
                            <span>•</span>
                            <span className="truncate max-w-xs text-[11px] text-muted-foreground/80">
                              Recent: {item.sampleDates.slice(-3).join(", ")}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {/* Right: Currency Selection Controls */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0">
                      <div className="flex items-center gap-1">
                        {POPULAR_CURRENCIES.map((code) => {
                          const isSelected = currentInput === code;
                          return (
                            <button
                              key={code}
                              onClick={() => {
                                handleCurrencySelect(item.merchantCanonicalId, code);
                                handleSave(item.merchantCanonicalId, code);
                              }}
                              disabled={isPending}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                isSelected
                                  ? "bg-primary text-primary-foreground shadow-2xs"
                                  : "border border-border/80 bg-background text-foreground hover:bg-muted"
                              } disabled:opacity-50`}
                            >
                              {code}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Input
                          placeholder="ISO"
                          value={currentInput}
                          maxLength={3}
                          onChange={(e) =>
                            handleCurrencySelect(
                              item.merchantCanonicalId,
                              e.target.value.toUpperCase(),
                            )
                          }
                          className="h-7 w-16 px-2 text-center text-xs font-mono uppercase"
                          disabled={isPending}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSave(item.merchantCanonicalId)}
                          disabled={isPending || !/^[A-Z]{3}$/.test(currentInput)}
                          className="h-7 px-2.5 text-xs font-medium"
                        >
                          {isPending ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Feedback Message */}
                  {currentFeedback ? (
                    <div
                      className={`mt-3 flex items-center gap-2 rounded-xl p-2.5 text-xs ${
                        currentFeedback.type === "success"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                          : "bg-destructive/10 text-destructive border border-destructive/20"
                      }`}
                    >
                      {currentFeedback.type === "success" ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="size-3.5 shrink-0" />
                      )}
                      <span>{currentFeedback.message}</span>
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
