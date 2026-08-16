import Link from "next/link";
import { AlertCard } from "@/components/alert-card";
import { ALL_RULES, applyDismissals, evaluateRules } from "@/engine/rules";
import { getOrCreateProfile } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { buildSnapshot } from "@/lib/snapshot";

export default async function MoneyFinderPage({
  searchParams,
}: {
  searchParams: Promise<{ dismissed?: string }>;
}) {
  const userId = await requireUserId();
  const { dismissed: showDismissed } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const [profile, snapshot, dismissals] = await Promise.all([
    getOrCreateProfile(userId),
    buildSnapshot(userId, today),
    prisma.alert.findMany({ where: { userId }, select: { ruleKey: true, entityRef: true } }),
  ]);

  const { alerts, errors } = evaluateRules(profile, snapshot, ALL_RULES);
  const { active, dismissed } = applyDismissals(alerts, dismissals);
  const shown = showDismissed ? dismissed : active;
  const compliance = shown.filter((a) => a.kind === "compliance");
  const opportunities = shown.filter((a) => a.kind === "opportunity");

  return (
    <main className="space-y-8 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Money Finder</h1>
          <p className="text-sm text-muted-foreground">
            {showDismissed
              ? `${dismissed.length} dismissed alert(s)`
              : `${active.length} active — rules evaluate fresh on every load`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/money-finder/tax" className="text-sm underline">
            Tax checklist
          </Link>
          <Link href={showDismissed ? "/money-finder" : "/money-finder?dismissed=1"} className="text-sm underline">
            {showDismissed ? "Show active" : `Dismissed (${dismissed.length})`}
          </Link>
        </div>
      </header>

      {errors.length > 0 ? (
        <div className="rounded border border-red-600 p-4 text-sm">
          <p className="font-medium">Rule errors (the rest still evaluated):</p>
          <ul className="mt-1 list-inside list-disc">
            {errors.map((e) => (
              <li key={e.ruleKey}>
                {e.ruleKey}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section>
        <h2 className="font-medium">Compliance ({compliance.length})</h2>
        <div className="mt-3 space-y-3">
          {compliance.map((a) => (
            <AlertCard key={`${a.ruleKey}:${a.entityRef}`} alert={a} mode={showDismissed ? "dismissed" : "active"} />
          ))}
          {compliance.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : null}
        </div>
      </section>

      <section>
        <h2 className="font-medium">Opportunities ({opportunities.length})</h2>
        <div className="mt-3 space-y-3">
          {opportunities.map((a) => (
            <AlertCard key={`${a.ruleKey}:${a.entityRef}`} alert={a} mode={showDismissed ? "dismissed" : "active"} />
          ))}
          {opportunities.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : null}
        </div>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        MoneyTalks surfaces published program rules against your own data, with citations. It is not
        financial, tax, or legal advice; verify with your accountant or caseworker before acting.
        Rules inputs come from <Link href="/settings" className="underline">Settings</Link>.
      </footer>
    </main>
  );
}
