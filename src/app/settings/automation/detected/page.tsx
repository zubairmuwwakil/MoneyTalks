import { requireUserId } from "@/lib/require-user";
import DetectedInbox from "@/app/automation/ui/DetectedInbox";

export default async function SettingsDetectedPage() {
  await requireUserId();

  return (
    <main className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-[#0b1220] p-6 shadow-2xl shadow-black/50">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 top-2 h-56 w-56 rounded-full bg-cyan-500/20 blur-[120px]" />
          <div className="absolute right-[-80px] top-8 h-56 w-56 rounded-full bg-emerald-400/18 blur-[120px]" />
        </div>
        <div className="relative">
          <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100">Settings</p>
          <h1 className="font-display text-4xl text-white">Detected</h1>
          <p className="text-sm text-slate-200/80">Review detected trials, renewals, and bills.</p>
        </div>
      </div>

      <DetectedInbox />
    </main>
  );
}
