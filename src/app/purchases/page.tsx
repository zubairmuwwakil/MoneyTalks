import { requireUserId } from "@/lib/require-user";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";

export default async function PurchasesInboxPage() {
  const userId = await requireUserId();

  const purchases = await prisma.purchase.findMany({
    where: { userId },
    include: { returns: true },
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
            <p className="text-sm text-slate-200/80">Unified purchase proof feed from Gmail and uploads.</p>
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
            return (
              <Link key={p.id} href={`/purchases/${p.id}`} className="block">
                <div className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{p.merchant}</div>
                      <div className="text-xs text-slate-500">
                        {p.purchasedAt.toISOString().slice(0, 10)}
                        {p.orderNumber ? ` · Order ${p.orderNumber}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      {typeof p.totalCents === "number" ? (
                        <div className="text-sm font-semibold text-slate-900">{formatMoney(p.totalCents, p.currency)}</div>
                      ) : null}
                      {returnStatus ? (
                        <div className="text-xs text-slate-500">Return: {returnStatus}</div>
                      ) : (
                        <div className="text-xs text-slate-400">No return</div>
                      )}
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
