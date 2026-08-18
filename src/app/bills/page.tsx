import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  CreditCard,
  Info,
  LineChart,
  Plus,
  Receipt,
} from "lucide-react";
import { allocateRecommendedCard } from "@/app/bills/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { Catalogue, OwnerState } from "@/engine/cards-twin";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import {
  computeBillAllocation,
  summarizeBillAllocations,
  type BillAllocationResult,
} from "@/lib/domain/bills/billAllocationSummary";
import { recommendCardForBill, type BillRecommendationResult } from "@/lib/domain/bills/cardForBill";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

// Computed once at module load, not per request — the contract JSON never
// changes at runtime. Cast from the zod-validated CardCatalogue shape
// (src/lib/contracts/cardCatalogue.ts) to cards-twin's own Catalogue type;
// the two are structurally compatible (same precedent as
// ownerStateRecord.stateData's cast to OwnerState in the wallet-events
// route — see src/app/api/v1/wallet-events/route.ts).
const catalogue = cardCatalogue as unknown as Catalogue;

/**
 * Compact "pay with" hint for a bill row. Renders nothing for statuses that
 * don't need row-level explanation (no cards on file — a single page-level
 * banner covers that; no upcoming occurrence; an internal engine error,
 * which is logged server-side instead of surfaced as user-facing noise).
 */
function BillCardHint({ rec }: { rec: BillRecommendationResult }) {
  if (rec.status === "no-cards" || rec.status === "no-upcoming-occurrence" || rec.status === "engine-error") {
    return null;
  }

  if (rec.status === "skipped") {
    return (
      <p className="text-[11px] italic text-muted-foreground">
        {rec.reason === "excluded-category" ? rec.detail : `No card pick — ${rec.detail}`}
      </p>
    );
  }

  const { winner, runnerUp, isClose, gapCad, mcc, engineCategory, amountIsEstimate, mappingRationale } = rec;
  return (
    <p
      className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground"
      title={`Assumed MCC ${mcc} for "${engineCategory}" (not observed from this bill) — ${mappingRationale}`}
    >
      <CreditCard className="size-3 shrink-0" />
      <span className="font-medium text-foreground">{winner.cardName}</span>
      <span>· {winner.earnDescription}</span>
      {amountIsEstimate ? <span>(est. amount)</span> : null}
      {isClose && runnerUp ? (
        <span className="text-muted-foreground/80">
          · close call vs {runnerUp.cardName} (+{formatMinorUnits(Math.round((gapCad ?? 0) * 100), "CAD")})
        </span>
      ) : null}
      <Info className="size-3 shrink-0 text-muted-foreground/50" />
    </p>
  );
}

/**
 * The allocation half of the row — a card was already assigned to this
 * bill (`Bill.paymentCardId`), so show it and whether it's still the best
 * choice. Renders nothing for "excluded" (BillCardHint's skip line already
 * covers that) and "unallocated" (that case gets the separate one-click
 * allocate form below, which — being a real `<form>`/`<button>` — can't
 * live inside the row's own `<Link>`).
 */
function BillAllocationStatus({
  alloc,
  cardName,
}: {
  alloc: BillAllocationResult;
  cardName: string;
}) {
  if (alloc.status === "excluded" || alloc.status === "unallocated") return null;

  if (alloc.status === "unscoreable") {
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground" title={alloc.detail}>
        <AlertTriangle className="size-3 shrink-0 text-amber-600" />
        Paying with {cardName} — can&apos;t evaluate (not linked to the catalogue)
      </p>
    );
  }

  if (alloc.status === "optimal") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Paying with <span className="font-medium text-foreground">{cardName}</span>
        <Badge variant="success" size="sm">best card</Badge>
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      Paying with <span className="font-medium text-foreground">{cardName}</span>
      <Badge variant="warning" size="sm">
        suboptimal{alloc.amountIsEstimate ? " · est." : ""} · ~
        {formatMinorUnits(Math.round((alloc.annualDeltaCad ?? 0) * 100), "CAD")}/yr
      </Badge>
    </p>
  );
}

/**
 * The payoff line: "N of M bills are on a suboptimal card — about $X/yr
 * left on the table." `annualDeltaCad` only ever sums "suboptimal" bills
 * (see billAllocationSummary.ts) — excluded/unallocated/unscoreable bills
 * are surfaced in the second line instead of being folded into the total as
 * zero, so the number never quietly understates itself.
 */
function BillAllocationSummaryBanner({ summary }: { summary: ReturnType<typeof summarizeBillAllocations> }) {
  const { suboptimalCount, totalBills, annualDeltaCad, includesEstimate, excludedCount, unallocatedCount, unscoreableCount } = summary;

  const asides: string[] = [];
  if (unallocatedCount > 0) asides.push(`${unallocatedCount} not yet allocated`);
  if (unscoreableCount > 0) asides.push(`${unscoreableCount} on a card not linked to the catalogue`);
  if (excludedCount > 0) asides.push(`${excludedCount} excluded (housing/debt or otherwise unscoreable)`);

  return (
    <div className="rounded-xl border border-border/80 bg-card px-4 py-3 shadow-2xs">
      {suboptimalCount > 0 ? (
        <p className="flex items-center gap-2 text-sm">
          <Badge variant="warning">{suboptimalCount} of {totalBills}</Badge>
          <span className="text-foreground">
            bill{suboptimalCount === 1 ? " is" : "s are"} on a suboptimal card — {includesEstimate ? "about " : ""}
            <span className="font-semibold">
              {formatMinorUnits(Math.round(annualDeltaCad) * 100, "CAD")}/yr
            </span>{" "}
            left on the table.
          </span>
        </p>
      ) : (
        <p className="text-sm text-foreground">
          Every allocated, scoreable bill is already on its best owned card.
        </p>
      )}
      {asides.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{asides.join(" · ")}.</p>
      ) : null}
    </div>
  );
}

function toBillDef(b: {
  id: string;
  name: string;
  category: string;
  currency: string;
  autopay: boolean;
  variable: boolean;
  cadence: unknown;
  schedule: unknown;
}): BillDef {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    currency: b.currency,
    autopay: b.autopay,
    variable: b.variable,
    cadence: b.cadence as Cadence,
    schedule: b.schedule as ScheduleEntry[],
  };
}

export default async function BillsPage() {
  const userId = await requireUserId();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 400 * 86_400_000).toISOString().slice(0, 10);
  // Separate, exact 12-month horizon for the allocation summary's occurrence
  // count — `horizon` above is deliberately padded to 400 days just so a
  // bill anchored near the boundary still has a "next" date to show; the
  // per-bill annual-delta math needs the real "next 12 months" window.
  const horizon365 = new Date(now.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);

  // Owner state and FX rates are loaded ONCE for the whole page — the engine
  // is microsecond-fast, so a straightforward per-bill loop below is fine,
  // but the catalogue/owner-state/rates lookups themselves are not repeated
  // per bill. Same ensureOwnerStateRecord -> stateData cast precedent as
  // src/app/api/v1/wallet-events/route.ts.
  const [bills, ownerStateRecord, fxRatesRaw, paymentCards] = await Promise.all([
    prisma.bill.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    ensureOwnerStateRecord(prisma, userId),
    prisma.fxRate.findMany({ where: { userId, asOf: { lte: now } }, orderBy: [{ quote: "asc" }, { asOf: "desc" }] }),
    prisma.creditCard.findMany({ where: { userId }, select: { id: true, nickname: true, contractCardId: true } }),
  ]);

  const ownerState = ownerStateRecord ? (ownerStateRecord.stateData as unknown as OwnerState) : null;
  const hasCards = ownerState !== null && ownerState.ownedCardIds.length > 0;
  const fxRates: FxRateInput[] = fxRatesRaw.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));
  const cardById = new Map(paymentCards.map((c) => [c.id, c]));

  const withNext = bills.map((b) => {
    const def = toBillDef(b);
    const next = billOccurrences(def, today, horizon)[0] ?? null;
    const rec = recommendCardForBill(
      catalogue,
      ownerState,
      { category: b.category, currency: b.currency, variable: b.variable },
      next ? { amountMinor: next.amountMinor } : null,
      fxRates,
      today,
      { override: b.spendCategory ?? undefined },
    );
    const occurrenceCount12mo = billOccurrences(def, today, horizon365).length;
    const paymentCard = b.paymentCardId ? cardById.get(b.paymentCardId) ?? null : null;
    const alloc = computeBillAllocation({
      billId: b.id,
      rec,
      paymentCardId: b.paymentCardId,
      paymentCardContractId: paymentCard?.contractCardId ?? null,
      occurrenceCount12mo,
      amountIsEstimate: b.variable,
    });
    return { bill: b, next, rec, alloc, paymentCardName: paymentCard?.nickname ?? null };
  });

  const allocationSummary = summarizeBillAllocations(withNext.map(({ alloc }) => alloc));

  const categories = [...new Set(bills.map((b) => b.category))].sort();

  // A `<form action>` must be `(formData) => void | Promise<void>` —
  // `allocateRecommendedCard` returns `Promise<ActionResult>` (same
  // ActionResult convention every action in src/app/bills/actions.ts uses),
  // so it's wrapped rather than passed directly. No redirect needed here
  // (unlike the detail page's submit* wrappers): the action's own
  // `revalidatePath` calls are enough to refresh this list.
  async function submitAllocateRecommended(formData: FormData) {
    "use server";
    await allocateRecommendedCard(formData);
  }

  return (
    <main className="space-y-6 py-6 sm:py-8">
      {/* Header with Title and Quick Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">
            Recurring expenses, schedule stepping, pileup warnings, and 12-month cashflow forecasts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/bills/month" className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              <span>Month view</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/bills/forecast" className="flex items-center gap-1.5">
              <LineChart className="size-3.5" />
              <span>Forecast</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/bills/new" className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              <span>Add bill</span>
            </Link>
          </Button>
        </div>
      </div>

      {bills.length > 0 && hasCards ? <BillAllocationSummaryBanner summary={allocationSummary} /> : null}

      {bills.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills yet"
          description="Track subscriptions, utilities, rent/mortgage, and recurring debt payments."
          action={{
            label: "Add your first bill",
            href: "/bills/new",
          }}
          secondaryAction={{
            label: "Import from JSON",
            href: "/investments/import",
          }}
        />
      ) : (
        <div className="space-y-6">
          {!hasCards ? (
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CreditCard className="size-4 shrink-0" />
                <span>Add a card to see which one to pay each bill with.</span>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/cards">Add a card</Link>
              </Button>
            </div>
          ) : null}
          {categories.map((category) => (
            <section key={category} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px] font-semibold uppercase tracking-wider">
                  {category}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  ({withNext.filter(({ bill }) => bill.category === category).length})
                </span>
              </div>
              <ul className="divide-y divide-border/60 rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
                {withNext
                  .filter(({ bill }) => bill.category === category)
                  .map(({ bill, next, rec, alloc, paymentCardName }) => (
                    <li key={bill.id} className="transition-colors hover:bg-muted/40">
                      <Link
                        href={`/bills/${bill.id}`}
                        className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm sm:text-base tracking-tight text-foreground">
                              {bill.name}
                            </span>
                            {bill.autopay ? (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                autopay
                              </Badge>
                            ) : null}
                            {bill.variable ? (
                              <Badge variant="info" className="px-1.5 py-0 text-[10px]">
                                variable
                              </Badge>
                            ) : null}
                          </div>
                          {bill.payee ? (
                            <p className="text-xs text-muted-foreground">Payee: {bill.payee}</p>
                          ) : null}
                          <BillCardHint rec={rec} />
                          {paymentCardName ? <BillAllocationStatus alloc={alloc} cardName={paymentCardName} /> : null}
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3">
                          <div className="text-right">
                            {next ? (
                              <p className="text-sm font-semibold tabular-nums text-foreground">
                                {next.date} · {formatMinorUnits(next.amountMinor, bill.currency as Currency)}
                                {bill.variable ? (
                                  <span className="text-xs font-normal text-muted-foreground ml-1">(est.)</span>
                                ) : null}
                              </p>
                            ) : (
                              <span className="text-xs text-muted-foreground">no upcoming date</span>
                            )}
                          </div>
                          <ChevronRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </Link>
                      {alloc.status === "unallocated" && rec.status === "recommended" ? (
                        <form
                          action={submitAllocateRecommended}
                          className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/10 px-5 py-2"
                        >
                          <input type="hidden" name="billId" value={bill.id} />
                          <p className="text-[11px] text-muted-foreground">
                            Not yet allocated — recommended:{" "}
                            <span className="font-medium text-foreground">{rec.winner.cardName}</span>
                          </p>
                          <Button type="submit" variant="outline" size="xs" className="shrink-0">
                            Allocate
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
