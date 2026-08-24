// Automation settings surface

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { requireUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import AutomationHome from "@/app/automation/ui/AutomationHome";

export default async function SettingsAutomationPage() {
  const userId = await requireUserId();
  const incompleteCaptureCount = await prisma.walletEvent.count({
    where: { userId, processingStatus: "INCOMPLETE" },
  });

  return (
    <main className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-[#0b1220] p-6 shadow-2xl shadow-black/50">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 top-2 h-56 w-56 rounded-full bg-cyan-500/20 blur-[120px]" />
          <div className="absolute right-[-80px] top-8 h-56 w-56 rounded-full bg-emerald-400/18 blur-[120px]" />
        </div>
        <div className="relative">
          <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100">Settings</p>
          <h1 className="font-display text-4xl text-white">Automation</h1>
          <p className="text-sm text-slate-200/80">Connect Gmail, scan recent receipts, and jump into inbox review.</p>
        </div>
      </div>

      {incompleteCaptureCount > 0 ? (
        <Link
          href="/purchases/recovery"
          className="group flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 transition-colors hover:bg-amber-500/15"
        >
          <span className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold">{incompleteCaptureCount} Wallet capture{incompleteCaptureCount === 1 ? "" : "s"} need attention</span>
              <span className="block text-xs text-muted-foreground">Correct missing details and add them to Purchases.</span>
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-amber-700 transition-transform group-hover:translate-x-0.5 dark:text-amber-300" />
        </Link>
      ) : null}

      <AutomationHome />
    </main>
  );
}
