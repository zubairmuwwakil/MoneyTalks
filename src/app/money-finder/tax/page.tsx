import Link from "next/link";
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

// Print-friendly: a border rather than a fill, so the badges survive a black-and-white
// printout of the checklist, which is how this page is meant to be used.
const STATUS_STYLE: Record<ChecklistStatus, string> = {
  REQUIRED: "border-red-600 text-red-700",
  LIKELY: "border-amber-600 text-amber-700",
  CHECK: "border-blue-600 text-blue-700",
  NOT_APPLICABLE: "border-muted-foreground/40 text-muted-foreground",
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
    <main className="max-w-3xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Tax checklist — {year}</h1>
        <p className="text-sm text-muted-foreground">
          Built fresh from your own data every time this page loads. Each line names the figure
          behind it, so you can hand the list to whoever prepares your return.
        </p>
        <Link href="/money-finder" className="text-sm underline">
          ← back to Money Finder
        </Link>
      </header>

      {ORDER.map((status) => {
        const group = items.filter((i) => i.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status} className="space-y-2">
            <h2 className="text-sm font-medium">
              {STATUS_LABEL[status]} ({group.length})
            </h2>
            <ul className="divide-y rounded border">
              {group.map((i) => (
                <li key={i.item} className="space-y-1 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{i.item}</span>
                    <span
                      className={`shrink-0 rounded border px-2 py-0.5 text-xs ${STATUS_STYLE[i.status]}`}
                    >
                      {STATUS_LABEL[i.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{i.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="border-t pt-4 text-xs text-muted-foreground">
        MoneyTalks flags that a form is likely required. It never files one, and this is not
        financial or tax advice. Cross-border filing has nuances this app does not model — confirm
        scope with a cross-border accountant before you file.
      </p>
    </main>
  );
}
