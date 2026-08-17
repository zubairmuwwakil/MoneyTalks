import { requireUserId } from "@/lib/require-user";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import { purchaseLocalDateTime } from "@/lib/utils/purchaseTime";

const PAGE_SIZE = 50;

type SearchParams = {
  flagged?: string | string[];
  page?: string | string[];
  q?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function pageNumber(value: string | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function purchasesHref({ page, q, flagged }: { page?: number; q: string; flagged: boolean }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (flagged) params.set("flagged", "1");
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/purchases?${query}` : "/purchases";
}

export default async function PurchasesInboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const q = firstParam(params.q)?.trim() ?? "";
  const flagged = firstParam(params.flagged) === "1";
  const page = pageNumber(firstParam(params.page));
  const where = {
    userId,
    ...(q ? { merchant: { contains: q, mode: "insensitive" as const } } : {}),
    ...(flagged ? { possibleDuplicateOfId: { not: null } } : {}),
  };

  const [pref, purchasesWithNextPage, flaggedCount] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
    prisma.purchase.findMany({
      where,
      include: {
        returns: true,
        walletEvents: {
          select: { capturedAt: true, capturedTimezone: true, feedbackWarning: true },
          orderBy: { capturedAt: "asc" },
          take: 1,
        },
        emailTransactions: { select: { id: true }, take: 1 },
      },
      orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    }),
    prisma.purchase.count({
      where: { userId, possibleDuplicateOfId: { not: null } },
    }),
  ]);
  const homeZone = pref?.timezone ?? null;
  const hasNextPage = purchasesWithNextPage.length > PAGE_SIZE;
  const purchases = purchasesWithNextPage.slice(0, PAGE_SIZE);
  const resultsLabel = flagged ? "flagged purchases" : "purchases";

  return (
    <main className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-linear-to-br from-slate-950 via-slate-900 to-[#0b1220] p-6 shadow-2xl shadow-black/50">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 top-0 h-56 w-56 rounded-full bg-cyan-400/20 blur-[110px]" />
          <div className="absolute -right-15 top-10 h-64 w-64 rounded-full bg-emerald-400/18 blur-[110px]" />
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.26em] text-cyan-100">Purchases</p>
            <h1 className="font-display text-4xl text-white">Purchases Inbox</h1>
            <p className="text-sm text-slate-200/80">Every purchase, from tap to receipt, in one record.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {flaggedCount > 0 ? (
              <Link
                className="rounded-full bg-amber-100/15 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-100/25"
                href={purchasesHref({ q, flagged: !flagged })}
              >
                {flagged ? "All purchases" : `${flaggedCount} flagged`}
              </Link>
            ) : null}
            <Link className="pill-link" href="/receipts/upload">
              Upload receipt
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <form action="/purchases" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {flagged ? <input type="hidden" name="flagged" value="1" /> : null}
          <label className="sr-only" htmlFor="purchase-merchant-search">
            Search merchants
          </label>
          <input
            className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            defaultValue={q}
            id="purchase-merchant-search"
            name="q"
            placeholder="Search merchants"
            type="search"
          />
          <div className="flex items-center gap-2">
            <button className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700" type="submit">
              Search
            </button>
            {(q || flagged) ? (
              <Link className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100" href="/purchases">
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </div>

      {purchases.length === 0 ? (
        <div className="rounded-2xl border bg-white/80 p-6 text-sm text-slate-600">
          {q || flagged ? `No ${resultsLabel} match these filters.` : "No purchases yet."}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
            <span>
              Page {page} · {purchases.length} {resultsLabel}
            </span>
            {q ? <span>Matching “{q}”</span> : null}
          </div>
          <div className="space-y-3">
            {purchases.map((p) => {
              const returnStatus = p.returns[0]?.status ?? null;
              const wallet = p.walletEvents[0] ?? null;
              const seenByEmail = p.emailTransactions.length > 0 || p.source === "GMAIL" || p.source === "UPLOAD";
              const seenByWallet = wallet != null || p.source === "WALLET";
              const local = purchaseLocalDateTime(
                wallet?.capturedAt ?? p.purchasedAt,
                wallet?.capturedTimezone,
                homeZone,
              );
              // A wallet tap is an exact instant; email/manual dates are only day-accurate.
              const when = wallet ? local.toFormat("MMM d, yyyy · h:mm a") : local.toFormat("MMM d, yyyy");
              return (
                <Link key={p.id} href={`/purchases/${p.id}`} className="block">
                  <div className="rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{p.merchant}</span>
                          {wallet?.feedbackWarning ? (
                            <span title={wallet.feedbackWarning} className="text-xs">⚠️</span>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-500">
                          {when}
                          {p.orderNumber ? ` · Order ${p.orderNumber}` : ""}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {seenByWallet ? (
                            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">Wallet</span>
                          ) : null}
                          {seenByEmail ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Receipt</span>
                          ) : null}
                          {p.possibleDuplicateOfId ? (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Possible duplicate</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right">
                        {typeof p.totalCents === "number" ? (
                          <div className="text-sm font-semibold text-slate-900">{formatMoney(p.totalCents, p.currency)}</div>
                        ) : null}
                        {returnStatus ? (
                          <div className="text-xs text-slate-500">Return: {returnStatus}</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          {page > 1 || hasNextPage ? (
            <nav aria-label="Purchases pages" className="flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link className="pill-link" href={purchasesHref({ page: page - 1, q, flagged })}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              {hasNextPage ? (
                <Link className="pill-link" href={purchasesHref({ page: page + 1, q, flagged })}>
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      )}
    </main>
  );
}
