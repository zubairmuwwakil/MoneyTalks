import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  addScheduleEntry,
  deleteBill,
  markPaid,
  removeScheduleEntry,
  unmarkPaid,
} from "@/app/bills/actions";
import { Badge } from "@/components/ui/badge";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import { formatMinorUnits, type Currency } from "@/engine/money";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

function billErrorPath(billId: string, form: string, message: string) {
  return `/bills/${billId}?errorForm=${form}&error=${encodeURIComponent(message)}`;
}

const inputStyle =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

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
  const bill = await prisma.bill.findFirst({ where: { id, userId }, include: { payments: true } });
  if (!bill) notFound();

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
  const now = new Date();
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
