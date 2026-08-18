import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CreditCard, Trash2 } from "lucide-react";
import {
  addScheduleEntry,
  deleteBill,
  markPaid,
  removeScheduleEntry,
  setBillPaymentCard,
  setBillSpendCategory,
  unmarkPaid,
} from "@/app/bills/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Catalogue, OwnerState } from "@/engine/cards-twin";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { computeBillAllocation, type BillAllocationResult } from "@/lib/domain/bills/billAllocationSummary";
import { billSpendCategoryOptions, recommendCardForBill, type BillRecommendationResult } from "@/lib/domain/bills/cardForBill";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

// Same module-level singleton as src/app/bills/page.tsx — see that file's
// comment for why this cast is safe and why it's computed once, not per
// request.
const catalogue = cardCatalogue as unknown as Catalogue;
const spendCategoryOptions = billSpendCategoryOptions(catalogue);

function billErrorPath(billId: string, form: string, message: string) {
  return `/bills/${billId}?errorForm=${form}&error=${encodeURIComponent(message)}`;
}

const inputStyle =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

/**
 * Fuller "pay with" panel for the bill detail page — the winner and its
 * earn reason, the runner-up and gap when the race is close, and the
 * disclosed-MCC note explaining exactly which spend category and MCC were
 * assumed and why (per this codebase's honesty posture: an assumed MCC must
 * be disclosed, never hidden — see src/lib/domain/bills/cardForBill.ts).
 */
function BillCardRecommendationPanel({ rec }: { rec: BillRecommendationResult }) {
  if (rec.status === "no-cards") {
    return (
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Add a card to get a pay-with recommendation for this bill.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/cards">Add a card</Link>
        </Button>
      </div>
    );
  }

  if (rec.status === "no-upcoming-occurrence") {
    return <p className="mt-3 text-sm text-muted-foreground">No upcoming occurrence to recommend a card for.</p>;
  }

  if (rec.status === "engine-error") {
    return <p className="mt-3 text-sm text-muted-foreground">Unable to score a recommendation for this bill right now.</p>;
  }

  if (rec.status === "skipped") {
    return <p className="mt-3 text-sm text-muted-foreground">{rec.detail}</p>;
  }

  const { winner, runnerUp, isClose, gapCad, mcc, engineCategory, amountIsEstimate, mappingRationale, categorySource } = rec;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <CreditCard className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{winner.cardName}</p>
          <p className="text-xs text-muted-foreground">
            {winner.earnDescription}
            {amountIsEstimate ? " · based on an estimated amount (bill is marked variable)" : ""}
          </p>
        </div>
      </div>

      {runnerUp ? (
        <p className="text-xs text-muted-foreground">
          Runner-up: {runnerUp.cardName} ({runnerUp.earnDescription})
          {gapCad !== null
            ? ` — ${winner.cardName} ahead by ${formatMinorUnits(Math.round(gapCad * 100), "CAD")}${isClose ? ", a close call" : ""}`
            : ""}
        </p>
      ) : null}

      <p className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground/90">
        Assumed MCC {mcc} for the &ldquo;{engineCategory}&rdquo; spend category (
        {categorySource === "override" ? "pinned for this bill" : "derived from the bill's category"}) — not
        observed from this bill. {mappingRationale}
      </p>
    </div>
  );
}

/**
 * Reports the allocated card's standing against the best owned card. Renders
 * nothing for "excluded" — `BillCardRecommendationPanel` above already
 * explains why no recommendation exists at all, and this section would just
 * repeat it.
 */
function BillAllocationStatusPanel({
  allocation,
  allocatedCardName,
}: {
  allocation: BillAllocationResult;
  allocatedCardName: string | null;
}) {
  if (allocation.status === "excluded") return null;

  if (allocation.status === "unallocated") {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No card allocated yet — pick one above, or use the recommended card.
      </p>
    );
  }

  if (allocation.status === "unscoreable") {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
        <span>
          {allocatedCardName ?? "This card"} isn&apos;t linked to the catalogue, so it can&apos;t be evaluated —{" "}
          <Link href="/settings/wallet" className="underline hover:text-foreground">
            link it under Settings → Apple Wallet
          </Link>
          .
        </span>
      </p>
    );
  }

  if (allocation.status === "optimal") {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="success">best card</Badge>
        <span>{allocatedCardName} is already the best owned card for this bill.</span>
      </p>
    );
  }

  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="warning">suboptimal</Badge>
      <span>
        About {formatMinorUnits(Math.round((allocation.annualDeltaCad ?? 0) * 100), "CAD")}/yr more available on the
        best owned card{allocation.amountIsEstimate ? " (based on an estimated amount)" : ""}.
      </span>
    </p>
  );
}

export default async function BillDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; errorForm?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { error, errorForm } = await searchParams;
  const now = new Date();

  const [bill, ownerStateRecord, fxRatesRaw, ownedCards] = await Promise.all([
    prisma.bill.findFirst({ where: { id, userId }, include: { payments: true } }),
    ensureOwnerStateRecord(prisma, userId),
    prisma.fxRate.findMany({ where: { userId, asOf: { lte: now } }, orderBy: [{ quote: "asc" }, { asOf: "desc" }] }),
    prisma.creditCard.findMany({ where: { userId }, select: { id: true, nickname: true, contractCardId: true }, orderBy: { nickname: "asc" } }),
  ]);
  if (!bill) notFound();

  const ownerState = ownerStateRecord ? (ownerStateRecord.stateData as unknown as OwnerState) : null;
  const fxRates: FxRateInput[] = fxRatesRaw.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  const currency = bill.currency as Currency;
  const schedule = bill.schedule as unknown as ScheduleEntry[];
  const def: BillDef = {
    id: bill.id,
    name: bill.name,
    category: bill.category,
    currency: bill.currency,
    autopay: bill.autopay,
    variable: bill.variable,
    cadence: bill.cadence as unknown as Cadence,
    schedule,
  };
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = billOccurrences(def, today, horizon);
  const paidByDate = new Map(
    bill.payments.map((p) => [p.dueDate.toISOString().slice(0, 10), p]),
  );
  const pastPayments = bill.payments
    .filter((p) => p.paidAt)
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))
    .slice(0, 24);

  const cardRec = recommendCardForBill(
    catalogue,
    ownerState,
    { category: bill.category, currency: bill.currency, variable: bill.variable },
    upcoming[0] ? { amountMinor: upcoming[0].amountMinor } : null,
    fxRates,
    today,
    { override: bill.spendCategory ?? undefined },
  );

  const allocatedCard = bill.paymentCardId ? (ownedCards.find((c) => c.id === bill.paymentCardId) ?? null) : null;
  const allocation = computeBillAllocation({
    billId: bill.id,
    rec: cardRec,
    paymentCardId: bill.paymentCardId,
    paymentCardContractId: allocatedCard?.contractCardId ?? null,
    // `upcoming` above is already the exact next-12-months occurrence list
    // for this bill (365-day horizon) — no separate query needed here.
    occurrenceCount12mo: upcoming.length,
    amountIsEstimate: bill.variable,
  });

  async function submitAddSchedule(formData: FormData) {
    "use server";
    const result = await addScheduleEntry(formData);
    if (!result.ok) redirect(billErrorPath(id, "schedule", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitRemoveSchedule(formData: FormData) {
    "use server";
    const result = await removeScheduleEntry(formData);
    if (!result.ok) redirect(billErrorPath(id, "schedule", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitMarkPaid(formData: FormData) {
    "use server";
    const result = await markPaid(formData);
    if (!result.ok) redirect(billErrorPath(id, "payments", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitUnmarkPaid(formData: FormData) {
    "use server";
    const result = await unmarkPaid(formData);
    if (!result.ok) redirect(billErrorPath(id, "payments", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitDeleteBill(formData: FormData) {
    "use server";
    const result = await deleteBill(formData);
    if (!result.ok) redirect(billErrorPath(id, "bill", result.error));
    redirect("/bills");
  }

  async function submitSetSpendCategory(formData: FormData) {
    "use server";
    const result = await setBillSpendCategory(formData);
    if (!result.ok) redirect(billErrorPath(id, "spendCategory", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitSetPaymentCard(formData: FormData) {
    "use server";
    const result = await setBillPaymentCard(formData);
    if (!result.ok) redirect(billErrorPath(id, "paymentCard", result.error));
    redirect(`/bills/${id}`);
  }

  return (
    <main className="space-y-8 py-6 sm:py-8">
      <div>
        <Link
          href="/bills"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Bills</span>
        </Link>
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{bill.name}</h1>
            <Badge variant="outline" className="text-xs font-semibold uppercase">
              {bill.category}
            </Badge>
            {bill.autopay ? <Badge variant="secondary">autopay</Badge> : null}
            {bill.variable ? <Badge variant="info">variable</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {bill.category}
            {bill.payee ? ` · ${bill.payee}` : ""} · {bill.currency}
            {bill.autopay ? " · autopay" : ""}
            {bill.variable ? " · variable" : ""}
            {bill.prepaymentMonthDay ? ` · prepayment window ${bill.prepaymentMonthDay}` : ""}
            {bill.interestRatePct !== null ? ` · ${Number(bill.interestRatePct)}%` : ""}
          </p>
          {bill.notes ? <p className="mt-2 text-xs text-foreground/80 rounded-lg bg-muted/40 p-2.5">{bill.notes}</p> : null}
        </header>
      </div>

      {/* Pay With Recommendation */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Pay with</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Which of your cards earns the most on this bill&apos;s next charge.
        </p>
        <BillCardRecommendationPanel rec={cardRec} />

        <div className="mt-5 space-y-4 border-t border-border/60 pt-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Spend category
            </p>
            <form action={submitSetSpendCategory} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="billId" value={bill.id} />
              <select name="spendCategory" defaultValue={bill.spendCategory ?? ""} className={`${inputStyle} max-w-64`}>
                <option value="">Auto (from category)</option>
                {spendCategoryOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Save
              </button>
            </form>
            {errorForm === "spendCategory" && error ? (
              <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Payment card
            </p>
            {ownedCards.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No cards on file yet.{" "}
                <Link href="/cards/new" className="underline hover:text-foreground">
                  Add a card
                </Link>{" "}
                to allocate one.
              </p>
            ) : (
              <form action={submitSetPaymentCard} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="billId" value={bill.id} />
                <select
                  name="paymentCardId"
                  defaultValue={bill.paymentCardId ?? ""}
                  className={`${inputStyle} max-w-64`}
                >
                  <option value="">Not allocated</option>
                  {ownedCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nickname}
                      {c.contractCardId ? "" : " (not linked to catalogue)"}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  Save
                </button>
              </form>
            )}
            {errorForm === "paymentCard" && error ? (
              <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <BillAllocationStatusPanel allocation={allocation} allocatedCardName={allocatedCard?.nickname ?? null} />
          </div>
        </div>
      </section>

      {/* Amount Schedule Section */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Amount schedule</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Define stepped pricing over time for leases, mortgage rate resets, or promo periods.
        </p>

        <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
          {schedule.map((s, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium text-xs sm:text-sm">
                {s.from} → {s.to ?? "open"} {s.note ? <span className="text-muted-foreground ml-1">· {s.note}</span> : null}
              </span>
              <span className="flex items-center gap-3 tabular-nums font-semibold">
                {formatMinorUnits(s.amountMinor, currency)}
                <form action={submitRemoveSchedule}>
                  <input type="hidden" name="billId" value={bill.id} />
                  <input type="hidden" name="index" value={i} />
                  <button
                    type="submit"
                    className="p-1 text-muted-foreground hover:text-red-600 transition-colors cursor-pointer"
                    title="Remove schedule step"
                  >
                    <Trash2 className="size-3.5 text-red-600" />
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Add schedule step
          </p>
          <form action={submitAddSchedule} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <input type="hidden" name="billId" value={bill.id} />
            <input name="from" type="date" required className={inputStyle} />
            <input name="to" type="date" placeholder="To date (optional)" className={inputStyle} />
            <input name="amount" placeholder="Amount ($)" required className={inputStyle} />
            <input name="note" placeholder="Note (optional)" className={inputStyle} />
            <button
              type="submit"
              className="col-span-2 sm:col-span-1 inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-3 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
            >
              Add schedule entry
            </button>
          </form>
          {errorForm === "schedule" && error ? (
            <p className="mt-2 text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {/* Next 12 Months Payment Checklist */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Next 12 months</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Upcoming payment dates. Mark payments as paid or track variable invoice amounts.
        </p>

        <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
          {upcoming.map((o) => {
            const payment = paidByDate.get(o.date);
            return (
              <li key={o.date} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">{o.date}</span>
                  {payment?.paidAt ? (
                    <Badge variant="success" className="text-[10px]">
                      paid
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 tabular-nums font-semibold">
                  <span>
                    {formatMinorUnits(o.amountMinor, currency)}
                    {bill.variable ? " (est.)" : ""}
                  </span>
                  {payment?.paidAt ? (
                    <form action={submitUnmarkPaid}>
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="dueDate" value={o.date} />
                      <button
                        type="submit"
                        className="text-xs text-muted-foreground underline hover:text-foreground cursor-pointer"
                      >
                        un-mark
                      </button>
                    </form>
                  ) : (
                    <form action={submitMarkPaid} className="flex items-center gap-1.5">
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="dueDate" value={o.date} />
                      {bill.variable ? (
                        <input
                          name="actualAmount"
                          placeholder="actual $"
                          className="w-20 rounded-md border border-input bg-background px-2 py-0.5 text-xs shadow-2xs"
                        />
                      ) : null}
                      <button
                        type="submit"
                        className="rounded-md border border-border/80 bg-muted/60 px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                      >
                        mark paid
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {errorForm === "payments" && error ? (
          <p className="mt-2 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {/* Logged Past Payments */}
      {pastPayments.length > 0 ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">Logged payments (estimate vs actual)</h2>
          <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
            {pastPayments.map((p) => {
              const delta = (p.actualAmountMinor ?? p.expectedAmountMinor) - p.expectedAmountMinor;
              return (
                <li key={p.id} className="flex justify-between px-4 py-3 text-sm tabular-nums">
                  <span className="font-mono text-xs text-muted-foreground">
                    {p.dueDate.toISOString().slice(0, 10)}
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatMinorUnits(p.actualAmountMinor ?? p.expectedAmountMinor, currency)}
                    {delta !== 0 ? (
                      <span className={delta > 0 ? "ml-2 text-red-600 text-xs font-medium" : "ml-2 text-emerald-600 text-xs font-medium"}>
                        ({delta > 0 ? "+" : ""}{formatMinorUnits(delta, currency)} vs est.)
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Delete Bill Section */}
      <div className="border-t border-border/60 pt-6">
        <form action={submitDeleteBill}>
          <input type="hidden" name="id" value={bill.id} />
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 transition-colors cursor-pointer"
          >
            <Trash2 className="size-3.5" />
            <span>Delete bill (and its payment log)</span>
          </button>
          {errorForm === "bill" && error ? (
            <p className="mt-2 text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
