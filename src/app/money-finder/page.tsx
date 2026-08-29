import Link from "next/link";
import {
  FileCheck,
  Receipt,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { AlertCard } from "@/components/alert-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <main className="space-y-8 py-6 sm:py-8">
      {/* Header with Title, Status Description, and Primary Sub-nav */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Money Finder</h1>
          <p className="text-sm text-muted-foreground">
            {showDismissed
              ? `${dismissed.length} dismissed alert(s)`
              : `${active.length} active — rules evaluate fresh on every load`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/money-finder/write-offs" className="flex items-center gap-1.5 text-sm underline">
              <Receipt className="size-3.5 text-primary" />
              <span>CRA Write-Offs</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/money-finder/tax" className="flex items-center gap-1.5 text-sm underline">
              <FileCheck className="size-3.5" />
              <span>Tax checklist</span>
            </Link>
          </Button>
          <Button asChild variant={showDismissed ? "secondary" : "outline"} size="sm">
            <Link
              href={showDismissed ? "/money-finder" : "/money-finder?dismissed=1"}
              className="flex items-center gap-1.5 text-sm underline"
            >
              <RotateCcw className="size-3.5" />
              <span>{showDismissed ? "Show active" : `Dismissed (${dismissed.length})`}</span>
            </Link>
          </Button>
        </div>
      </header>

      {errors.length > 0 ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600">
          <p className="font-semibold">Rule errors (the rest still evaluated):</p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5">
            {errors.map((e) => (
              <li key={e.ruleKey}>
                {e.ruleKey}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Compliance Section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Compliance ({compliance.length})
          </h2>
        </div>
        <div className="space-y-3">
          {compliance.map((a) => (
            <AlertCard key={`${a.ruleKey}:${a.entityRef}`} alert={a} mode={showDismissed ? "dismissed" : "active"} />
          ))}
          {compliance.length === 0 ? (
            <Card className="p-5 text-center">
              <p className="text-xs text-muted-foreground">Nothing here.</p>
            </Card>
          ) : null}
        </div>
      </section>

      {/* Opportunities Section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Opportunities ({opportunities.length})
          </h2>
        </div>
        <div className="space-y-3">
          {opportunities.map((a) => (
            <AlertCard key={`${a.ruleKey}:${a.entityRef}`} alert={a} mode={showDismissed ? "dismissed" : "active"} />
          ))}
          {opportunities.length === 0 ? (
            <Card className="p-5 text-center">
              <p className="text-xs text-muted-foreground">Nothing here.</p>
            </Card>
          ) : null}
        </div>
      </section>

      {/* Citations and Legal Disclaimer Footer */}
      <footer className="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs text-muted-foreground leading-relaxed">
        In Unity surfaces published program rules against your own data, with citations. It is not
        financial, tax, or legal advice; verify with your accountant or caseworker before acting.
        Rules inputs come from{" "}
        <Link href="/settings" className="font-semibold text-foreground underline hover:text-foreground/80">
          Settings
        </Link>
        .
      </footer>
    </main>
  );
}
