import { requireUserId } from "@/lib/require-user";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/utils/calendarEvents";
import ReturnTransactionHistory from "@/app/returns/ui/ReturnTransactionHistory";

export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();

  const { id } = await params;
  if (!id) {
    notFound();
  }

  const ret = await prisma.returnItem.findUnique({
    where: { id },
  });

  if (!ret || ret.userId !== userId) {
    notFound();
  }

  const statusColors: Record<string, string> = {
    NOT_STARTED: "bg-slate-500/25 text-slate-100",
    PACKED: "bg-amber-500/25 text-amber-50",
    DROPPED_OFF: "bg-blue-500/25 text-blue-50",
    DELIVERED: "bg-cyan-500/25 text-cyan-50",
    REFUNDED: "bg-emerald-500/25 text-emerald-50",
  };

  const statusIcons: Record<string, string> = {
    NOT_STARTED: "📋",
    PACKED: "📦",
    DROPPED_OFF: "🚚",
    DELIVERED: "📬",
    REFUNDED: "✅",
  };

  const isRefunded = ret.status === "REFUNDED";
  const isExpectedRefund = ret.refundExpectedAt ? new Date() < ret.refundExpectedAt : false;
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  return (
    <div className="space-y-6 text-slate-50">
      <div className="flex items-start justify-between rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/30">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Return detail</p>
          <h1 className="text-3xl font-bold text-white">{ret.store}</h1>
          <p className="mt-1 text-slate-300">
            Purchased {ret.purchaseDate.toLocaleDateString("en-CA")}
          </p>
        </div>
        <span className={`rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap ${statusColors[ret.status]}`}>
          {statusIcons[ret.status]} {ret.status.replaceAll("_", " ")}
        </span>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold text-slate-400">Purchase Amount</p>
          <p className="mt-2 text-2xl font-bold text-white">
            {formatMoney(ret.amountCents ?? 0, ret.currency)}
          </p>
        </div>
        <div className={`rounded-xl border p-4 ${isRefunded ? "border-emerald-300/30 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
          <p className={`text-xs font-semibold ${isRefunded ? "text-emerald-100" : "text-slate-400"}`}>
            {isRefunded ? "Refunded Amount" : "Estimated Refund"}
          </p>
          <p className={`mt-2 text-2xl font-bold ${isRefunded ? "text-white" : "text-slate-100"}`}>
            {formatMoney(ret.refundAmountCents ?? ret.amountCents ?? 0, ret.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold text-slate-400">Return Window</p>
          <p className="mt-2 text-2xl font-bold text-white">{ret.returnWindowDays} days</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold text-slate-400">Tracking</p>
          <p className="mt-2 text-sm font-semibold text-white">
            {ret.trackingNumber ?? "—"} {ret.carrier ? `· ${ret.carrier}` : ""}
          </p>
          {ret.deliveredAt ? (
            <p className="text-xs text-emerald-100">Delivered {ret.deliveredAt.toLocaleDateString("en-CA")}</p>
          ) : (
            <p className="text-xs text-slate-400">{ret.dropoffDate ? "In transit" : "Waiting for label"}</p>
          )}
        </div>
        <div className={`rounded-xl border p-4 ${isExpectedRefund ? "border-amber-300/30 bg-amber-500/10" : "border-white/10 bg-white/5"}`}>
          <p className={`text-xs font-semibold ${isExpectedRefund ? "text-amber-100" : "text-slate-400"}`}>
            Estimated Time to Refund
          </p>
          {ret.refundExpectedAt && (
            <p className={`mt-2 text-2xl font-bold ${isExpectedRefund ? "text-white" : "text-slate-100"}`}>
              {Math.max(0, Math.ceil((ret.refundExpectedAt.getTime() - nowMs) / (1000 * 60 * 60 * 24)))} days
            </p>
          )}
        </div>
      </div>

      {/* Return Details */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30">
        <h2 className="mb-4 text-lg font-semibold text-white">Details</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-400">Store</p>
            <p className="mt-1 font-medium text-white">{ret.store}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">Purchase Date</p>
            <p className="mt-1 text-slate-100">{ret.purchaseDate.toLocaleDateString("en-CA")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">Return Deadline</p>
            <p className="mt-1 text-slate-100">{ret.returnBy.toLocaleDateString("en-CA")}</p>
          </div>
          {ret.dropoffDate && (
            <div>
              <p className="text-xs font-semibold text-slate-400">Dropped Off</p>
              <p className="mt-1 text-slate-100">{ret.dropoffDate.toLocaleDateString("en-CA")}</p>
            </div>
          )}
          {ret.deliveredAt && (
            <div>
              <p className="text-xs font-semibold text-slate-400">Delivered</p>
              <p className="mt-1 text-slate-100">{ret.deliveredAt.toLocaleDateString("en-CA")} · SLA {ret.refundSlaDays}d</p>
            </div>
          )}
          {ret.refundExpectedAt && (
            <div>
              <p className="text-xs font-semibold text-slate-400">Estimated Refund By</p>
              <p className="mt-1 text-slate-100">{ret.refundExpectedAt.toLocaleDateString("en-CA")}</p>
            </div>
          )}
          {ret.trackingNumber && (
            <div>
              <p className="text-xs font-semibold text-slate-400">Tracking</p>
              <p className="mt-1 text-slate-100">{ret.trackingNumber} {ret.carrier ? `(${ret.carrier})` : ""}</p>
            </div>
          )}
          {ret.refundedDate && (
            <div>
              <p className="text-xs font-semibold text-slate-400">Refunded On</p>
              <p className="mt-1 font-medium text-emerald-100">{ret.refundedDate.toLocaleDateString("en-CA")}</p>
            </div>
          )}
          {ret.itemNote && (
            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-slate-400">Item Notes</p>
              <p className="mt-1 text-slate-100">{ret.itemNote}</p>
            </div>
          )}
        </div>
      </div>

      {/* Transaction History */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Timeline</h2>
          <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-100">Estimated shipment progress</span>
        </div>
        <ReturnTransactionHistory userId={userId} returnId={ret.id} />
      </div>
    </div>
  );
}
