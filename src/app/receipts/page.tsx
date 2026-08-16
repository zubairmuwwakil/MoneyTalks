import { requireUserId } from "@/lib/require-user";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[idx]}`;
}

function statusChip(status: string) {
  const map: Record<string, { text: string; cls: string }> = {
    PARSED: { text: "Parsed", cls: "bg-emerald-100 text-emerald-800" },
    NEEDS_REVIEW: { text: "Needs review", cls: "bg-amber-100 text-amber-800" },
    FAILED: { text: "Failed", cls: "bg-rose-100 text-rose-800" },
  };
  return map[status] ?? { text: status, cls: "bg-slate-100 text-slate-700" };
}

export default async function ReceiptsPage() {
  const userId = await requireUserId();

  type UploadRow = {
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    status: string;
    createdAt: Date;
    error: string | null;
  };

  const uploads: UploadRow[] = await prisma.receiptUpload.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <main className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-[#0b1220] p-6 shadow-2xl shadow-black/50">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 top-0 h-56 w-56 rounded-full bg-cyan-400/20 blur-[110px]" />
          <div className="absolute right-[-60px] top-10 h-64 w-64 rounded-full bg-emerald-400/18 blur-[110px]" />
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.26em] text-cyan-100">Receipts</p>
            <h1 className="font-display text-4xl text-white">Centralize your proofs of purchase.</h1>
            <p className="text-sm text-slate-200/80">Upload PDFs or images, keep them searchable, and turn them into refunds or bill evidence.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="pill-link" href="/purchases">
              Purchases inbox
            </Link>
            <Link className="pill-link" href="/receipts/upload">
              Upload receipt
            </Link>
            <Link className="pill-link" href="/settings/automation/review">
              Inbox Review
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 shadow-xl shadow-black/30 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Recent uploads</p>
            <p className="text-sm text-slate-200">Latest first · {uploads.length} shown</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-emerald-100">Syncing</span>
        </div>

        {uploads.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-6 text-sm text-slate-200">
            No uploads yet. Try a PDF or image on the upload page.
          </div>
        ) : (
          <div className="mt-4 divide-y divide-white/10">
            {uploads.map((u) => {
              const chip = statusChip(u.status);
              return (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{u.filename}</div>
                    <div className="text-xs text-slate-400">
                      {u.contentType} · {formatBytes(u.sizeBytes)} · {u.createdAt.toISOString().slice(0, 10)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${chip.cls}`}>{chip.text}</span>
                    <a href={`/api/documents/${u.id}`} className="text-xs font-semibold text-cyan-100 hover:underline">Download</a>
                    {u.status === "FAILED" && u.error ? (
                      <span className="truncate text-xs text-rose-200">Error: {u.error}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
