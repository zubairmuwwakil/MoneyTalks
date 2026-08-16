import Link from "next/link";
import { requireUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import ReturnsBoard from "./ui/ReturnsBoard";

type ReturnRow = {
  id: string;
  store: string;
  itemNote: string | null;
  amountCents: number | null;
  currency: string;
  purchaseDate: Date;
  returnBy: Date;
  returnWindowDays: number;
  refundAmountCents: number | null;
  refundExpectedAt: Date | null;
  refundedDate: Date | null;
  status: "NOT_STARTED" | "PACKED" | "DROPPED_OFF" | "DELIVERED" | "REFUNDED";
  dropoffDate: Date | null;
  trackingNumber: string | null;
  carrier: string | null;
  deliveredAt: Date | null;
  refundSlaDays: number;
  refundType: string | null;
};

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const userId = await requireUserId();

  const params = await searchParams;
  const bucket: "active" | "refunded" = params?.bucket === "refunded" ? "refunded" : "active";

  const returns: ReturnRow[] = await prisma.returnItem.findMany({
    where: { userId },
    orderBy: { returnBy: "asc" },
    select: {
      id: true,
      store: true,
      itemNote: true,
      amountCents: true,
      currency: true,
      purchaseDate: true,
      returnBy: true,
      returnWindowDays: true,
      refundAmountCents: true,
      refundExpectedAt: true,
      refundedDate: true,
      status: true,
      dropoffDate: true,
      trackingNumber: true,
      carrier: true,
      deliveredAt: true,
      refundSlaDays: true,
      refundType: true,
    },
  });

  const stats = {
    total: returns.length,
    refunded: returns.filter(r => r.status === "REFUNDED").length,
    inProgress: returns.filter(r => r.status !== "REFUNDED").length,
    totalRefunded: returns
      .filter(r => r.status === "REFUNDED")
      .reduce((sum, r) => sum + (r.refundAmountCents ?? 0), 0),
    potentialRefunds: returns
      .filter(r => r.status !== "REFUNDED")
      .reduce((sum, r) => sum + (r.amountCents ?? 0), 0),
  };

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const focusReturns = returns
    .filter(r => r.status !== "REFUNDED")
    .sort((a, b) => a.returnBy.getTime() - b.returnBy.getTime())
    .slice(0, 2);

  const serialized = returns.map(r => ({
    ...r,
    purchaseDate: r.purchaseDate.toISOString(),
    returnBy: r.returnBy.toISOString(),
    refundExpectedAt: r.refundExpectedAt ? r.refundExpectedAt.toISOString() : null,
    refundedDate: r.refundedDate ? r.refundedDate.toISOString() : null,
    dropoffDate: r.dropoffDate ? r.dropoffDate.toISOString() : null,
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
    carrier: r.carrier,
    refundSlaDays: r.refundSlaDays,
    refundType: r.refundType,
  }));

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-[#0b1220] p-6 shadow-2xl shadow-black/50">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 top-6 h-56 w-56 rounded-full bg-cyan-500/20 blur-[120px]" />
          <div className="absolute right-[-60px] top-12 h-56 w-56 rounded-full bg-emerald-400/18 blur-[120px]" />
        </div>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100">Returns HQ</p>
            <h1 className="font-display text-4xl text-white">Deadline clarity with delightful status shifts.</h1>
            <p className="max-w-3xl text-sm text-slate-200/80">
              Data-dense list, timeline cards, and buttery transitions from NOT_STARTED → RETURNED → REFUNDED. Quick mark buttons keep you in flow.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white">Timeline view</span>
            <Link href="/settings/automation" className="pill-link">
              Automation
            </Link>
          </div>
        </div>

        <div className="relative mt-4 grid gap-3 md:grid-cols-4">
          <Link href="/returns?bucket=active" className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-emerald-300/50 hover:-translate-y-0.5">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Need to Return</p>
            <p className="mt-1 font-display text-2xl text-white">{stats.inProgress}</p>
            <p className="text-xs text-slate-400">{stats.total} total captured</p>
          </Link>
          <Link href="/returns?bucket=refunded" className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-400/15 to-emerald-500/10 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300/60">
            <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-100">Refunded</p>
            <p className="mt-1 font-display text-2xl text-white">{stats.refunded}</p>
            <p className="text-xs text-emerald-100">Received {formatMoney(stats.totalRefunded, "CAD")}</p>
          </Link>
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-400/20 to-emerald-500/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100">Potential refunds</p>
            <p className="mt-1 font-display text-2xl text-white">{formatMoney(stats.potentialRefunds, "CAD")}</p>
            <p className="text-xs text-cyan-100">Across active items</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Focus</p>
            {focusReturns.length === 0 ? (
              <p className="mt-2 text-sm text-slate-300">No urgent returns. Add your next deadline.</p>
            ) : (
              <div className="mt-1 space-y-1">
                {focusReturns.map(item => {
                  const daysLeft = Math.max(0, Math.ceil((item.returnBy.getTime() - nowMs) / (1000 * 60 * 60 * 24)));
                  return (
                    <div key={item.id} className="flex items-center justify-between text-sm text-white">
                      <span className="truncate">{item.store}</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-emerald-100">
                        {daysLeft}d
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ReturnsBoard items={serialized} stats={stats} initialBucket={bucket === "refunded" ? "refunded" : "active"} />
    </div>
  );
}
