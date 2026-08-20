import Link from "next/link";
import { ArrowRight, CheckCircle2, Gauge, Minus, TrendingUp } from "lucide-react";
import { formatMinorUnits } from "@/engine/money";
import type { WalletImpactRow, WalletImpactView } from "@/lib/domain/cards/walletImpact";

function statusCopy(row: WalletImpactRow): { label: string; className: string } {
  if (row.status === "no-fee") return { label: "No fee", className: "text-muted-foreground" };
  if (row.status === "ahead") return { label: `${formatMinorUnits(row.netMinor, "CAD")} ahead`, className: "text-emerald-700 dark:text-emerald-300" };
  if (row.status === "even") return { label: "At break-even", className: "text-emerald-700 dark:text-emerald-300" };
  return { label: `${formatMinorUnits(Math.abs(row.netMinor), "CAD")} short`, className: "text-amber-700 dark:text-amber-300" };
}

export function WalletImpactWorkspace({ view }: { view: WalletImpactView }) {
  const portfolioAhead = view.totalNetMinor >= 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xs" aria-labelledby="wallet-impact-title">
      <div className="grid gap-5 border-b border-border/70 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-muted-foreground" />
            <p id="wallet-impact-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Wallet break-even
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              {formatMinorUnits(view.totalRealizedMinor, "CAD")}
            </p>
            <span className={`text-xs font-semibold ${portfolioAhead ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
              {portfolioAhead
                ? `${formatMinorUnits(view.totalNetMinor, "CAD")} above fees`
                : `${formatMinorUnits(Math.abs(view.totalNetMinor), "CAD")} still to recover`}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest saved rewards estimates and {view.year} redeemed credits · effective fees {formatMinorUnits(view.totalFeeMinor, "CAD")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {view.feeCardCount > 0 ? (
            <>
              <CheckCircle2 className={`size-4 ${view.breakEvenCount === view.feeCardCount ? "text-emerald-600" : "text-muted-foreground"}`} />
              <span><strong>{view.breakEvenCount}</strong> of {view.feeCardCount} fee cards at break-even</span>
            </>
          ) : (
            <span className="text-muted-foreground">No annual fees to recover</span>
          )}
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {view.rows.map((row) => {
          const status = statusCopy(row);
          const markerLeft = Math.min(99, Math.max(0, row.feePct));
          const fillClass = row.status === "short" ? "bg-amber-500" : "bg-emerald-600";
          return (
            <Link
              key={row.id}
              href={`/cards/${row.id}`}
              className="group grid gap-3 px-5 py-4 transition-colors hover:bg-muted/25 sm:grid-cols-[11rem_minmax(0,1fr)_9rem] sm:items-center sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold group-hover:underline group-hover:underline-offset-4">{row.nickname}</p>
                <p className="truncate text-[11px] text-muted-foreground">{row.issuer}</p>
              </div>

              <div>
                <div className="relative h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className={`h-full rounded-full ${fillClass} transition-[width] duration-500`} style={{ width: `${row.valuePct}%` }} />
                  {row.feeMinor > 0 ? (
                    <span
                      className="absolute inset-y-[-3px] w-0.5 bg-foreground shadow-[0_0_0_1px_var(--background)]"
                      style={{ left: `${markerLeft}%` }}
                    />
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>Recorded {formatMinorUnits(row.realizedMinor, "CAD")}</span>
                  <span>{row.feeMinor > 0 ? `Fee ${formatMinorUnits(row.feeMinor, "CAD")}` : "No fee threshold"}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className={`text-xs font-semibold tabular-nums ${status.className}`}>{status.label}</span>
                {row.status === "short" ? <Minus className="size-3.5 text-amber-600" /> : <TrendingUp className="size-3.5 text-emerald-600" />}
                <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="border-t border-border/70 bg-muted/15 px-5 py-3 text-[11px] text-muted-foreground sm:px-6">
        Unredeemed catalogue benefits count as $0. Rewards use the latest saved estimate, which is not year-scoped.
      </div>
    </section>
  );
}
