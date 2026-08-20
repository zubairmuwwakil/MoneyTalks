import Link from "next/link";
import { CreditCard, FileSpreadsheet, Plus, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { FeeCycleNote } from "@/components/fee-cycle-note";
import { effectiveAnnualFeeMinor } from "@/lib/cards/catalogueCard";
import { currentFeeCycle, type FeeScheduleCard } from "@/lib/cards/feeSchedule";
import type { CardDef } from "@/lib/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function CardsPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    orderBy: { nickname: "asc" },
    include: { coverageReports: { orderBy: { month: "desc" }, take: 1 } },
  });

  const defs: FeeScheduleCard[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    feeRebateMinor: c.feeRebateMinor,
    contractCardId: c.contractCardId,
    feeMonthDay: c.feeMonthDay,
    feeCancelGraceDays: c.feeCancelGraceDays,
  }));

  const today = new Date();
  const cycles = defs.map((def) => currentFeeCycle(def, today));
  // A card that charges a real fee but has no renewal date can't be counted
  // down, and the field is worthless unfilled — so the prompt is the feature.
  const missingRenewalDate = defs.filter(
    (def, i) =>
      cycles[i] === null &&
      effectiveAnnualFeeMinor(def.annualFeeMinor, def.feeRebateMinor) > 0 &&
      !def.feeMonthDay,
  ).length;

  return (
    <main className="space-y-6 py-6 sm:py-8">
      {/* Header with Title and Manage Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wallet</h1>
          <p className="text-sm text-muted-foreground">
            Credit cards, reward multipliers, spending caps, and annual fee verdicts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/cards/reconcile" className="flex items-center gap-1.5">
              <FileSpreadsheet className="size-3.5" />
              <span>Reconcile statement</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/cards/manage" className="flex items-center gap-1.5">
              <Settings2 className="size-3.5" />
              <span>Manage</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/cards/new" className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              <span>Add card</span>
            </Link>
          </Button>
        </div>
      </div>

      {missingRenewalDate > 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-500">
          {missingRenewalDate} card{missingRenewalDate === 1 ? "" : "s"} with an annual fee{" "}
          {missingRenewalDate === 1 ? "has" : "have"} no renewal date set — add one to see how long
          you have to cancel before it charges.
        </p>
      ) : null}

      {defs.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No cards yet"
          description="Add your cards to track rewards, multi-spend category bonuses, credits, and fee waivers."
          action={{
            label: "add your first card",
            href: "/cards/new",
          }}
          secondaryAction={{
            label: "Import from JSON",
            href: "/investments/import",
          }}
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
          {cards.map((c, i) => (
            <li key={c.id} className="transition-colors hover:bg-muted/40">
              <Link
                href={`/cards/${c.id}`}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm sm:text-base tracking-tight">
                      {c.nickname}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {c.network}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.issuer} - {c.network}
                    {c.lastFour ? ` - ...${c.lastFour}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    fee {formatMinorUnits(effectiveAnnualFeeMinor(defs[i].annualFeeMinor, defs[i].feeRebateMinor), "CAD")}/yr
                  </span>
                  {cycles[i] ? (
                    <FeeCycleNote cycle={cycles[i]!} today={today} currency={c.currency as Currency} className="mt-1 block" />
                  ) : null}
                  {c.coverageReports[0] ? (
                    <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                      capture coverage {c.coverageReports[0].eligibleLines === 0 ? "—" : `${Math.round((c.coverageReports[0].matchedLines / c.coverageReports[0].eligibleLines) * 100)}%`}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
