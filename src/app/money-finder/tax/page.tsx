import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buildTaxChecklist, type ChecklistStatus } from "@/engine/taxchecklist";
import { getOrCreateProfile } from "@/lib/profile";
import { requireUserId } from "@/lib/require-user";
import { buildSnapshot } from "@/lib/snapshot";

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  REQUIRED: "Required",
  LIKELY: "Likely",
  CHECK: "Check",
  NOT_APPLICABLE: "Not applicable",
};

// Print-friendly: border with soft tint so badges survive both screen and print
const STATUS_STYLE: Record<ChecklistStatus, string> = {
  REQUIRED: "border-red-600/60 bg-red-500/10 text-red-700 dark:text-red-400 font-semibold",
  LIKELY: "border-amber-600/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold",
  CHECK: "border-sky-600/60 bg-sky-500/10 text-sky-700 dark:text-sky-300 font-semibold",
  NOT_APPLICABLE: "border-muted-foreground/40 bg-muted/40 text-muted-foreground",
};

const ORDER: ChecklistStatus[] = ["REQUIRED", "LIKELY", "CHECK", "NOT_APPLICABLE"];

export default async function TaxChecklistPage() {
  const userId = await requireUserId();
  const today = new Date().toISOString().slice(0, 10);
  const [profile, snapshot] = await Promise.all([
    getOrCreateProfile(userId),
    buildSnapshot(userId, today),
  ]);
  const items = buildTaxChecklist(profile, snapshot);
  const year = today.slice(0, 4);

  return (
    <main className="max-w-3xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/money-finder"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors underline"
        >
          <ArrowLeft className="size-3.5" />
          <span>← back to Money Finder</span>
        </Link>
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Tax checklist — {year}</h1>
          <p className="text-sm text-muted-foreground">
            Built fresh from your own data every time this page loads. Each line names the figure
            behind it, so you can hand the list to whoever prepares your return.
          </p>
        </header>
      </div>

      <div className="space-y-6">
        {ORDER.map((status) => {
          const group = items.filter((i) => i.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status} className="space-y-2.5">
              <h2 className="text-sm font-semibold text-foreground">
                {STATUS_LABEL[status]} ({group.length})
              </h2>
              <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
                {group.map((i) => (
                  <li key={i.item} className="space-y-1.5 px-5 py-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold text-sm text-foreground">{i.item}</span>
                      <span
                        className={`shrink-0 rounded-md border px-2.5 py-0.5 text-xs ${STATUS_STYLE[i.status]}`}
                      >
                        {STATUS_LABEL[i.status]}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{i.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs text-muted-foreground leading-relaxed">
        MoneyTalks flags that a form is likely required. It never files one, and this is not
        financial or tax advice. Cross-border filing has nuances this app does not model — confirm
        scope with a cross-border accountant before you file.
      </footer>
    </main>
  );
}
