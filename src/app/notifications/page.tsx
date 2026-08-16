import Link from "next/link";

import NotificationsClient from "./ui/NotificationsClient";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  return (
    <main className="space-y-5 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-black/25 backdrop-blur">
        <div>
          <h1 className="text-3xl font-semibold text-white">Notifications</h1>
          <p className="text-sm text-slate-300">What the system did and why. Mark items read or jump to the source.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className="pill-link" href="/returns">Returns</Link>
          <Link className="pill-link" href="/settings/automation/review">Inbox Review</Link>
        </div>
      </div>

      <NotificationsClient />
    </main>
  );
}
