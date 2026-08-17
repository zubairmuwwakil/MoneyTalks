import { requireUserId } from "@/lib/require-user";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import { purchaseLocalDateTime } from "@/lib/utils/purchaseTime";

export default async function PurchasesInboxPage() {
  const userId = await requireUserId();

  const purchases = await prisma.purchase.findMany({
    where: { userId },
    include: {
      returns: true,
      walletEvents: {
        select: { capturedAt: true, capturedTimezone: true, feedbackWarning: true },
        orderBy: { capturedAt: "asc" },
        take: 1,
      },
      emailTransactions: { select: { id: true }, take: 1 },
    },
    orderBy: { purchasedAt: "desc" },
    take: 200,
  });

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
            <Link className="pill-link" href="/receipts/upload">
              Upload receipt
            </Link>
          </div>
        </div>
      </div>

      {purchases.length === 0 ? (
        <div className="rounded-2xl border bg-white/80 p-6 text-sm text-slate-600">No purchases yet.</div>
      ) : (
        <div className="space-y-3">
          {purchases.map((p) => {
            const returnStatus = p.returns[0]?.status ?? null;
            const wallet = p.walletEvents[0] ?? null;
            const seenByEmail = p.emailTransactions.length > 0 || p.source === "GMAIL" || p.source === "UPLOAD";
            const seenByWallet = wallet != null || p.source === "WALLET";
            const local = purchaseLocalDateTime(
              wallet?.capturedAt ?? p.purchasedAt,
              wallet?.capturedTimezone,
            );
            // A wallet tap is an exact instant; email/manual dates are only day-accurate.
            const when = wallet ? local.toFormat("MMM d, yyyy · h:mm a") : local.toFormat("MMM d, yyyy");
            return (
              <Link key={p.id} href={`/purchases/${p.id}`} className="block">
                <div className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition">
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
      )}
    </main>
  );
}
