import Link from "next/link";
import { requireUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import SubscriptionsBoard from "./ui/SubscriptionsBoard";

type SubscriptionRow = {
  id: string;
  name: string;
  amountCents: number;
  currency: string;
  renewalDate: Date;
  cadence: "MONTHLY" | "YEARLY" | "CUSTOM";
  status: "ACTIVE" | "CANCELLED";
  notes: string | null;
};

export default async function SubscriptionsPage() {
  const userId = await requireUserId();

  const rows = await prisma.recurringObligation.findMany({
    where: { userId, kind: "SUBSCRIPTION" },
    include: { legacySubscription: { select: { legacySubscriptionId: true } } },
    orderBy: { nextExpectedDate: "asc" },
  });
  const subscriptions: SubscriptionRow[] = rows.map((row) => {
    const cadenceType = typeof row.cadence === "object" && row.cadence !== null && "type" in row.cadence
      ? (row.cadence as { type?: unknown }).type
      : null;
    const lastSchedule = Array.isArray(row.schedule) ? row.schedule.at(-1) : null;
    const amountCents = typeof lastSchedule === "object" && lastSchedule !== null && typeof (lastSchedule as { amountMinor?: unknown }).amountMinor === "number"
      ? (lastSchedule as { amountMinor: number }).amountMinor
      : 0;
    return {
      id: row.legacySubscription?.legacySubscriptionId ?? row.id,
      name: row.displayName ?? row.merchantCanonicalId ?? "Subscription",
      amountCents,
      currency: row.currency ?? "",
      renewalDate: row.nextExpectedDate ?? row.lastObservedAt,
      cadence: cadenceType === "MONTHLY" ? "MONTHLY" : cadenceType === "ANNUAL" ? "YEARLY" : "CUSTOM",
      status: row.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
      notes: row.notes,
    };
  });

  const active = subscriptions.filter(s => s.status === "ACTIVE");
  const monthly = active.filter(s => s.cadence === "MONTHLY");
  const annual = active.filter(s => s.cadence === "YEARLY");

  const monthlySpend = monthly.reduce((sum, s) => sum + (s.amountCents || 0), 0);
  const annualSpend = annual.reduce((sum, s) => sum + (s.amountCents || 0), 0);
  const nextRenewal = active[0];

  const stats = {
    activeCount: active.length,
    cancelledCount: subscriptions.filter(s => s.status === "CANCELLED").length,
    monthlySpend,
    annualSpend,
    nextRenewal: nextRenewal ? nextRenewal.renewalDate.toISOString() : null,
    nextName: nextRenewal?.name ?? null,
  };

  const serialized = subscriptions.map(sub => ({
    ...sub,
    renewalDate: sub.renewalDate.toISOString(),
  }));

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-[#0b1220] p-6 shadow-2xl shadow-black/50">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 top-0 h-56 w-56 rounded-full bg-emerald-400/18 blur-[120px]" />
          <div className="absolute right-[-80px] top-10 h-60 w-60 rounded-full bg-cyan-500/20 blur-[120px]" />
        </div>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-100">Subscriptions HQ</p>
            <h1 className="font-display text-4xl text-white">Next renewal is always obvious.</h1>
            <p className="max-w-3xl text-sm text-slate-200/80">
              Grouped by cadence with inline edits. Emphasis on what renews next, what to cancel, and how much you spend.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href="/notifications" className="pill-link">Notifications</Link>
            <span className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white">Inline edit</span>
          </div>
        </div>

        <div className="relative mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Active</p>
            <p className="font-display text-2xl text-white">{stats.activeCount}</p>
            <p className="text-xs text-slate-400">{stats.cancelledCount} cancelled</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-400/15 to-emerald-500/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-100">Monthly</p>
            <p className="font-display text-2xl text-white">{formatMoney(stats.monthlySpend, "CAD")}</p>
            <p className="text-xs text-emerald-100">per month</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-400/20 to-indigo-500/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100">Annual</p>
            <p className="font-display text-2xl text-white">{formatMoney(stats.annualSpend, "CAD")}</p>
            <p className="text-xs text-cyan-100">per year</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Next renewal</p>
            {stats.nextRenewal ? (
              <>
                <p className="font-display text-2xl text-white">{stats.nextName}</p>
                <p className="text-xs text-slate-300">{new Date(stats.nextRenewal).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</p>
              </>
            ) : (
              <p className="text-sm text-slate-300">Add your first subscription.</p>
            )}
          </div>
        </div>
      </div>

      <SubscriptionsBoard items={serialized} />
    </div>
  );
}
