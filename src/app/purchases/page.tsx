import Link from "next/link";
import {
  UploadCloud,
  Search,
  Receipt,
  CreditCard,
  AlertTriangle,
  ChevronRight,
  Smartphone,
  Sparkles,
  X,
  Plus,
  Calendar,
} from "lucide-react";
import type { FxRateInput } from "@/engine/fx";
import type { Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { formatMoney } from "@/lib/utils/calendarEvents";
import { purchaseLocalDateTime } from "@/lib/utils/purchaseTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SortSelect } from "./ui/SortSelect";
import { UnmappedCardPicker } from "./ui/UnmappedCardPicker";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { buildPurchaseImpact } from "@/lib/domain/purchases/purchaseImpact";
import { PurchaseImpactWorkspace } from "@/components/purchases/purchase-impact-workspace";
import { Prisma } from "@prisma/client";

const PAGE_SIZE = 50;

export type FilterOption = "all" | "missing_receipt" | "with_receipt" | "returns" | "flagged";
export type SortOption = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

type SearchParams = {
  flagged?: string | string[];
  page?: string | string[];
  q?: string | string[];
  filter?: string | string[];
  sort?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function pageNumber(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function purchasesHref({
  page,
  q,
  filter,
  sort,
}: {
  page?: number;
  q?: string;
  filter?: FilterOption;
  sort?: SortOption;
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filter && filter !== "all") params.set("filter", filter);
  if (sort && sort !== "date_desc") params.set("sort", sort);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/purchases?${query}` : "/purchases";
}

const AVATAR_GRADIENTS = [
  "from-indigo-500/20 via-purple-500/20 to-pink-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/25",
  "from-cyan-500/20 via-teal-500/20 to-emerald-500/20 text-teal-700 dark:text-teal-300 border-teal-500/25",
  "from-blue-500/20 via-sky-500/20 to-cyan-500/20 text-sky-700 dark:text-sky-300 border-sky-500/25",
  "from-amber-500/20 via-orange-500/20 to-red-500/20 text-amber-700 dark:text-amber-300 border-amber-500/25",
  "from-emerald-500/20 via-green-500/20 to-teal-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  "from-rose-500/20 via-pink-500/20 to-purple-500/20 text-rose-700 dark:text-rose-300 border-rose-500/25",
];

function getMerchantAvatar(name?: string | null) {
  const clean = (name ?? "Purchase").trim();
  if (!clean) return { initials: "P", gradient: AVATAR_GRADIENTS[0] };
  const words = clean.split(/\s+/).filter(Boolean);
  let initials = "";
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else {
    initials = clean.slice(0, 2).toUpperCase();
  }
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return { initials, gradient: AVATAR_GRADIENTS[idx] };
}

export default async function PurchasesInboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const q = firstParam(params.q)?.trim() ?? "";
  
  // Resolve filter, preserving backwards-compatibility with `flagged=1`
  const rawFilter = firstParam(params.filter) as FilterOption | undefined;
  const legacyFlagged = firstParam(params.flagged) === "1";
  const filter: FilterOption = legacyFlagged
    ? "flagged"
    : rawFilter && ["all", "missing_receipt", "with_receipt", "returns", "flagged"].includes(rawFilter)
      ? rawFilter
      : "all";

  const sort = (firstParam(params.sort) as SortOption) ?? "date_desc";
  const page = pageNumber(firstParam(params.page));

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);

  // Construct query where clause based on active filters
  const where: Prisma.PurchaseWhereInput = {
    userId,
    financialState: { notIn: ["DECLINED", "REVERSED"] },
    ...(q ? { merchant: { contains: q, mode: "insensitive" as const } } : {}),
  };

  if (filter === "flagged") {
    where.possibleDuplicateOfId = { not: null };
  } else if (filter === "missing_receipt") {
    where.emailTransactions = { none: {} };
    where.attachments = { none: {} };
    where.source = { notIn: ["GMAIL", "UPLOAD"] };
  } else if (filter === "with_receipt") {
    where.OR = [
      { emailTransactions: { some: {} } },
      { attachments: { some: {} } },
      { source: { in: ["GMAIL", "UPLOAD"] } },
    ];
  } else if (filter === "returns") {
    where.OR = [
      { returns: { some: {} } },
      { purchasedAt: { gte: thirtyDaysAgo } },
    ];
  }

  // Construct ordering
  const orderBy: Prisma.PurchaseOrderByWithRelationInput[] = [];
  if (sort === "amount_desc") {
    orderBy.push({ totalCents: "desc" }, { purchasedAt: "desc" });
  } else if (sort === "amount_asc") {
    orderBy.push({ totalCents: "asc" }, { purchasedAt: "desc" });
  } else if (sort === "date_asc") {
    orderBy.push({ purchasedAt: "asc" }, { id: "asc" });
  } else {
    // default date_desc
    orderBy.push({ purchasedAt: "desc" }, { id: "desc" });
  }

  // Execute parallel queries for stats, cards, timezone, and list
  const [pref, userCards, fxRatesRaw, allPurchasesSummary, purchasesWithNextPage] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
    prisma.creditCard.findMany({
      where: { userId, contractCardId: { not: null } },
      select: { nickname: true, contractCardId: true },
    }),
    prisma.fxRate.findMany({
      where: { userId, asOf: { lte: new Date(nowMs) } },
      orderBy: { asOf: "desc" },
    }),
    prisma.purchase.findMany({
      where: { userId, financialState: { notIn: ["DECLINED", "REVERSED"] } },
      select: {
        id: true,
        merchant: true,
        totalCents: true,
        currency: true,
        source: true,
        purchasedAt: true,
        possibleDuplicateOfId: true,
        emailTransactions: { select: { id: true }, take: 1 },
        attachments: { select: { id: true }, take: 1 },
        returns: {
          select: {
            id: true,
            status: true,
            refundedDate: true,
            refundAmountCents: true,
            amountCents: true,
            currency: true,
          },
        },
        walletEvents: {
          select: { capturedAt: true, capturedTimezone: true },
          orderBy: { capturedAt: "asc" },
          take: 1,
        },
      },
    }),
    prisma.purchase.findMany({
      where,
      include: {
        returns: true,
        items: { select: { id: true, title: true } },
        attachments: { select: { id: true } },
        walletEvents: {
          select: {
            capturedAt: true,
            capturedTimezone: true,
            feedbackWarning: true,
            resolvedCardId: true,
            cardRaw: true,
          },
          orderBy: { capturedAt: "asc" },
          take: 1,
        },
        emailTransactions: { select: { id: true, subject: true }, take: 1 },
      },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    }),
  ]);

  // Query missed rewards summary from wallet event warnings
  const missedRewardEvents = await prisma.walletEvent.findMany({
    where: { userId, feedbackWarning: { not: null } },
    select: { feedbackWarning: true },
  });

  let missedRewardsCents = 0;
  const missedRewardsCount = missedRewardEvents.length;
  for (const event of missedRewardEvents) {
    if (event.feedbackWarning) {
      const match = event.feedbackWarning.match(/~\$([0-9.]+)/);
      if (match && match[1]) {
        missedRewardsCents += Math.round(parseFloat(match[1]) * 100);
      }
    }
  }

  const homeZone = pref?.timezone ?? null;
  const hasNextPage = purchasesWithNextPage.length > PAGE_SIZE;
  const purchases = purchasesWithNextPage.slice(0, PAGE_SIZE);

  // Card lookup map
  const cardNameMap = new Map<string, string>();
  userCards.forEach((c) => {
    if (c.contractCardId) cardNameMap.set(c.contractCardId, c.nickname);
  });

  // Enriched card list for the UnmappedCardPicker — includes the catalogue
  // official name so fuzzy matching can compare "American Express Cobalt"
  // (cardRaw) against "American Express Cobalt Card" (officialName).
  const pickerCards = userCards
    .filter((c): c is { nickname: string; contractCardId: string } => !!c.contractCardId)
    .map((c) => ({
      ...c,
      officialName: cardCatalogue.cards.find((cat) => cat.cardId === c.contractCardId)?.officialName,
    }));

  const fxRates: FxRateInput[] = fxRatesRaw.map((rate) => ({
    base: rate.base as Currency,
    quote: rate.quote as Currency,
    rate: Number(rate.rate),
    asOf: rate.asOf.toISOString(),
  }));
  const purchaseImpact = buildPurchaseImpact(
    allPurchasesSummary.map((purchase) => {
      const wallet = purchase.walletEvents[0] ?? null;
      const local = purchaseLocalDateTime(
        wallet?.capturedAt ?? purchase.purchasedAt,
        wallet?.capturedTimezone,
        homeZone,
      );
      return {
        date: local.toISODate() ?? purchase.purchasedAt.toISOString().slice(0, 10),
        merchant: purchase.merchant,
        totalMinor: purchase.totalCents,
        currency: purchase.currency,
        refunds: purchase.returns.flatMap((item) => {
          const refundAmount = item.refundAmountCents ?? item.amountCents;
          return item.status === "REFUNDED" && item.refundedDate && typeof refundAmount === "number"
            ? [{
                date: item.refundedDate.toISOString().slice(0, 10),
                amountMinor: refundAmount,
                currency: item.currency ?? purchase.currency,
              }]
            : [];
        }),
      };
    }),
    fxRates,
    new Date(nowMs).toISOString().slice(0, 10),
  );

  // Calculate operational summary counts
  let withReceiptCount = 0;
  let flaggedCount = 0;
  let returnEligibleCount = 0;

  for (const p of allPurchasesSummary) {
    const hasReceipt =
      p.emailTransactions.length > 0 ||
      p.attachments.length > 0 ||
      p.source === "GMAIL" ||
      p.source === "UPLOAD";
    if (hasReceipt) {
      withReceiptCount++;
    }
    if (p.possibleDuplicateOfId) {
      flaggedCount++;
    }
    const isReturnEligible =
      p.returns.length > 0 || new Date(p.purchasedAt).getTime() >= thirtyDaysAgo.getTime();
    if (isReturnEligible) {
      returnEligibleCount++;
    }
  }

  const totalPurchasesCount = allPurchasesSummary.length;
  const missingReceiptCount = totalPurchasesCount - withReceiptCount;
  // Group purchases by month
  const groupedPurchases: {
    monthKey: string;
    monthLabel: string;
    items: typeof purchases;
  }[] = [];

  purchases.forEach((p) => {
    const wallet = p.walletEvents[0] ?? null;
    const local = purchaseLocalDateTime(wallet?.capturedAt ?? p.purchasedAt, wallet?.capturedTimezone, homeZone);
    const monthKey = local.toFormat("yyyy-MM");
    const monthLabel = local.toFormat("MMMM yyyy");

    let group = groupedPurchases.find((g) => g.monthKey === monthKey);
    if (!group) {
      group = { monthKey, monthLabel, items: [] };
      groupedPurchases.push(group);
    }
    group.items.push(p);
  });

  return (
    <main className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Purchases</h1>
            {flaggedCount > 0 ? (
              <Badge variant="warning" className="gap-1"><AlertTriangle className="size-3" />{flaggedCount} flagged</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Captured purchases, receipt evidence, returns, and duplicates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              size="sm"
            >
              <Link href="/receipts/upload" className="flex items-center gap-2">
                <UploadCloud className="size-4" />
                <span>Upload Receipt</span>
              </Link>
            </Button>
        </div>
      </div>

      {/* Rewards Optimization Opportunity Banner */}
      {missedRewardsCount > 0 ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-300">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Rewards Optimization Opportunity
              </p>
              <p className="text-sm font-bold text-foreground">
                ~{formatMoney(missedRewardsCents, "CAD")} missed across {missedRewardsCount} purchase{missedRewardsCount === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">
                Using recommended cards next time will maximize your points & cashback yield.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <PurchaseImpactWorkspace view={purchaseImpact} />

      {/* 3. Search & Filter Bar */}
      <div className="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
        <form action="/purchases" className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          {sort !== "date_desc" ? <input type="hidden" name="sort" value={sort} /> : null}

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-xl border border-input bg-background pl-9 pr-8 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/20 outline-none transition"
              defaultValue={q}
              id="purchase-merchant-search"
              name="q"
              placeholder="Search merchants, order numbers, or notes..."
              type="search"
            />
            {q ? (
              <Link
                href={purchasesHref({ filter, sort })}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X className="size-3.5" />
              </Link>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <SortSelect defaultValue={sort} />

            <Button type="submit" size="sm" variant="default" className="rounded-xl">
              Search
            </Button>
            {q || filter !== "all" || sort !== "date_desc" ? (
              <Button asChild variant="ghost" size="sm" className="rounded-xl text-xs">
                <Link href="/purchases">Reset</Link>
              </Button>
            ) : null}
          </div>
        </form>

        {/* Filter Chips / Quick Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
          <Link
            href={purchasesHref({ q, filter: "all", sort })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            All ({totalPurchasesCount})
          </Link>

          <Link
            href={purchasesHref({ q, filter: "missing_receipt", sort })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition flex items-center gap-1.5 ${
              filter === "missing_receipt"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span>Missing Receipt</span>
            {missingReceiptCount > 0 ? (
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                filter === "missing_receipt"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              }`}>
                {missingReceiptCount}
              </span>
            ) : null}
          </Link>

          <Link
            href={purchasesHref({ q, filter: "with_receipt", sort })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition flex items-center gap-1.5 ${
              filter === "with_receipt"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span>With Receipt</span>
            <span className="text-[10px] opacity-70">({withReceiptCount})</span>
          </Link>

          <Link
            href={purchasesHref({ q, filter: "returns", sort })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition flex items-center gap-1.5 ${
              filter === "returns"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span>Return Window</span>
            <span className="text-[10px] opacity-70">({returnEligibleCount})</span>
          </Link>

          {flaggedCount > 0 ? (
            <Link
              href={purchasesHref({ q, filter: "flagged", sort })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition flex items-center gap-1.5 ${
                filter === "flagged"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25"
              }`}
            >
              <AlertTriangle className="size-3" />
              <span>Flagged ({flaggedCount})</span>
            </Link>
          ) : null}
        </div>
      </div>

      {/* 4. Purchases List / Empty State */}
      {purchases.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={q || filter !== "all" ? "No matching purchases" : "No purchases recorded yet"}
          description={
            q || filter !== "all"
              ? "Try adjusting your search keywords or switching filters to view other transactions."
              : "Transactions synced via Apple Pay wallet taps or Gmail e-receipts will automatically appear here."
          }
          action={
            q || filter !== "all"
              ? {
                  label: "Clear filters",
                  href: "/purchases",
                }
              : {
                  label: "Upload your first receipt",
                  href: "/receipts/upload",
                }
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {purchases.length} result{purchases.length === 1 ? "" : "s"} · Page {page}
            </span>
            {q ? <span className="font-medium">Matching “{q}”</span> : null}
          </div>

          {/* Grouped by Month */}
          <div className="space-y-6">
            {groupedPurchases.map((group) => (
              <div key={group.monthKey} className="space-y-2.5">
                {/* Month header banner */}
                <div className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-3.5 text-primary" />
                    <span>{group.monthLabel}</span>
                  </div>
                  <span className="text-muted-foreground">
                    {group.items.length} purchase{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Purchases in Month */}
                <div className="divide-y divide-border/60 rounded-2xl border border-border/80 bg-card shadow-2xs overflow-hidden">
                  {group.items.map((p) => {
                    const returnStatus = p.returns[0]?.status ?? null;
                    const wallet = p.walletEvents[0] ?? null;
                    const hasEmail = p.emailTransactions.length > 0 || p.source === "GMAIL";
                    const hasAttachment = p.attachments.length > 0 || p.source === "UPLOAD";
                    const hasReceipt = hasEmail || hasAttachment;
                    const seenByWallet = wallet != null || p.source === "WALLET";

                    const local = purchaseLocalDateTime(
                      wallet?.capturedAt ?? p.purchasedAt,
                      wallet?.capturedTimezone,
                      homeZone
                    );
                    const when = wallet
                      ? local.toFormat("MMM d · h:mm a")
                      : local.toFormat("MMM d, yyyy");

                    const isUnmappedCard = !!(wallet?.cardRaw && !wallet.resolvedCardId);
                    const cardDisplay = wallet
                      ? (wallet.resolvedCardId ? cardNameMap.get(wallet.resolvedCardId) : null) ??
                        wallet.cardRaw ??
                        "Apple Pay"
                      : p.paymentMethod ?? "Card";

                    const avatar = getMerchantAvatar(p.merchant);

                    // Return window check
                    const purchaseDate = new Date(p.purchasedAt);
                    const returnDeadline = p.returns[0]?.returnBy ?? new Date(purchaseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
                    const daysRemaining = Math.ceil((returnDeadline.getTime() - nowMs) / (1000 * 60 * 60 * 24));
                    const isReturnActive = daysRemaining >= 0;

                    return (
                      <div
                        key={p.id}
                        className="group relative flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                      >
                        {/* Left block: Avatar + Merchant Info + Badges */}
                        <div className="flex items-start gap-3.5 min-w-0 flex-1">
                          <Link href={`/purchases/${p.id}`} className="shrink-0">
                            <div
                              className={`flex size-11 items-center justify-center rounded-xl border bg-linear-to-br ${avatar.gradient} font-bold text-sm shadow-2xs group-hover:scale-105 transition-transform`}
                            >
                              {avatar.initials}
                            </div>
                          </Link>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/purchases/${p.id}`}
                                className="font-semibold text-sm text-foreground hover:text-primary transition-colors truncate"
                              >
                                {p.merchant}
                              </Link>

                              {/* Source Badges */}
                              {seenByWallet ? (
                                <Badge variant="info" size="sm" className="gap-1">
                                  <Smartphone className="size-2.5" />
                                  <span>Wallet</span>
                                </Badge>
                              ) : null}

                              {hasReceipt ? (
                                <Badge variant="success" size="sm" className="gap-1">
                                  <Receipt className="size-2.5" />
                                  <span>Receipt</span>
                                </Badge>
                              ) : (
                                <Badge variant="warning" size="sm" className="gap-1">
                                  <span>No Receipt</span>
                                </Badge>
                              )}

                              {p.possibleDuplicateOfId ? (
                                <Badge variant="destructive" size="sm" className="gap-1">
                                  <AlertTriangle className="size-2.5" />
                                  <span>Possible duplicate</span>
                                </Badge>
                              ) : null}
                            </div>

                            {/* Subtitle Details: Date · Card · Items · Return status */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground/80">{when}</span>
                              <span>·</span>
                              {isUnmappedCard ? (
                                <UnmappedCardPicker cardRaw={wallet!.cardRaw!} cards={pickerCards} />
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <CreditCard className="size-3 text-muted-foreground/80" />
                                  <span>{cardDisplay}</span>
                                </span>
                              )}
                              {p.items.length > 0 ? (
                                <>
                                  <span>·</span>
                                  <span className="text-foreground/80">{p.items.length} item{p.items.length === 1 ? "" : "s"}</span>
                                </>
                              ) : null}
                              {p.orderNumber ? (
                                <>
                                  <span>·</span>
                                  <span className="font-mono text-[11px]">#{p.orderNumber}</span>
                                </>
                              ) : null}
                              {returnStatus ? (
                                <>
                                  <span>·</span>
                                  <span className="font-semibold text-sky-600 dark:text-sky-400">
                                    Return: {returnStatus}
                                  </span>
                                </>
                              ) : isReturnActive ? (
                                <>
                                  <span>·</span>
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    {daysRemaining}d return window
                                  </span>
                                </>
                              ) : null}
                            </div>

                            {/* Rewards Optimization Warning */}
                            {wallet?.feedbackWarning ? (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1 pt-0.5">
                                <AlertTriangle className="size-3 shrink-0" />
                                <span>{wallet.feedbackWarning}</span>
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {/* Right block: Amount + Actions */}
                        <div className="flex items-center justify-between sm:justify-end gap-3.5 border-t border-border/40 pt-2.5 sm:border-t-0 sm:pt-0 shrink-0">
                          {!hasReceipt ? (
                            <Button
                              asChild
                              variant="outline"
                              size="xs"
                              className="rounded-lg text-[11px] font-medium border-dashed hover:border-primary hover:text-primary transition"
                            >
                              <Link href="/receipts/upload">
                                <Plus className="size-3" /> Add Receipt
                              </Link>
                            </Button>
                          ) : null}

                          <div className="text-right">
                            {typeof p.totalCents === "number" ? (
                              <div className="text-base font-bold text-foreground sm:text-lg">
                                {formatMoney(p.totalCents, p.currency)}
                              </div>
                            ) : (
                              <div className="text-xs font-medium text-muted-foreground">Pending</div>
                            )}
                          </div>

                          <Link
                            href={`/purchases/${p.id}`}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                            aria-label={`View details for ${p.merchant}`}
                          >
                            <ChevronRight className="size-4" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 5. Pagination */}
          {page > 1 || hasNextPage ? (
            <nav aria-label="Purchases pages" className="flex items-center justify-between gap-3 pt-2">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm" className="rounded-full">
                  <Link href={purchasesHref({ page: page - 1, q, filter, sort })}>
                    Previous
                  </Link>
                </Button>
              ) : (
                <div />
              )}
              <span className="text-xs text-muted-foreground font-medium">Page {page}</span>
              {hasNextPage ? (
                <Button asChild variant="outline" size="sm" className="rounded-full">
                  <Link href={purchasesHref({ page: page + 1, q, filter, sort })}>
                    Next
                  </Link>
                </Button>
              ) : (
                <div />
              )}
            </nav>
          ) : null}
        </div>
      )}
    </main>
  );
}
