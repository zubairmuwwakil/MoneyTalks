import { notFound, redirect } from "next/navigation";
import {
  addScheduleEntry,
  deleteBill,
  markPaid,
  removeScheduleEntry,
  unmarkPaid,
} from "@/app/bills/actions";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

function billErrorPath(billId: string, form: string, message: string) {
  return `/bills/${billId}?errorForm=${form}&error=${encodeURIComponent(message)}`;
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
    <main className="space-y-8 py-8">
      <header>
        <h1 className="text-xl font-semibold">{bill.name}</h1>
        <p className="text-sm text-muted-foreground">
          {bill.category}{bill.payee ? ` · ${bill.payee}` : ""} · {bill.currency}
          {bill.autopay ? " · autopay" : ""}{bill.variable ? " · variable" : ""}
          {bill.prepaymentMonthDay ? ` · prepayment window ${bill.prepaymentMonthDay}` : ""}
          {bill.interestRatePct !== null ? ` · ${Number(bill.interestRatePct)}%` : ""}
        </p>
        {bill.notes ? <p className="mt-1 text-sm">{bill.notes}</p> : null}
      </header>

      <section>
        <h2 className="font-medium">Amount schedule</h2>
        <ul className="mt-2 divide-y rounded border">
          {schedule.map((s, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {s.from} → {s.to ?? "open"} {s.note ? <span className="text-muted-foreground">· {s.note}</span> : null}
              </span>
              <span className="flex items-center gap-3 tabular-nums">
                {formatMinorUnits(s.amountMinor, currency)}
                <form action={submitRemoveSchedule}>
                  <input type="hidden" name="billId" value={bill.id} />
                  <input type="hidden" name="index" value={i} />
                  <button type="submit" className="text-xs text-red-600">remove</button>
                </form>
              </span>
            </li>
          ))}
        </ul>
        <form action={submitAddSchedule} className="mt-3 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="billId" value={bill.id} />
          <input name="from" type="date" required className="rounded border px-2 py-1" />
          <input name="to" type="date" className="rounded border px-2 py-1" />
          <input name="amount" placeholder="Amount ($)" required className="rounded border px-2 py-1" />
          <input name="note" placeholder="Note" className="rounded border px-2 py-1" />
          <button type="submit" className="rounded border px-2 py-1">Add schedule entry</button>
        </form>
        {errorForm === "schedule" && error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>
        ) : null}
      </section>

      <section>
        <h2 className="font-medium">Next 12 months</h2>
        <ul className="mt-2 divide-y rounded border">
          {upcoming.map((o) => {
            const payment = paidByDate.get(o.date);
            return (
              <li key={o.date} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {o.date}
                  {payment?.paidAt ? <span className="ml-2 rounded bg-muted px-1 text-xs">paid</span> : null}
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  {formatMinorUnits(o.amountMinor, currency)}{bill.variable ? " (est.)" : ""}
                  {payment?.paidAt ? (
                    <form action={submitUnmarkPaid}>
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="dueDate" value={o.date} />
                      <button type="submit" className="text-xs underline">un-mark</button>
                    </form>
                  ) : (
                    <form action={submitMarkPaid} className="flex items-center gap-1">
                      <input type="hidden" name="billId" value={bill.id} />
                      <input type="hidden" name="dueDate" value={o.date} />
                      {bill.variable ? (
                        <input
                          name="actualAmount"
                          placeholder="actual $"
                          className="w-20 rounded border px-1 py-0.5 text-xs"
                        />
                      ) : null}
                      <button type="submit" className="text-xs underline">mark paid</button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {errorForm === "payments" && error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>
        ) : null}
      </section>

      {pastPayments.length > 0 ? (
        <section>
          <h2 className="font-medium">Logged payments (estimate vs actual)</h2>
          <ul className="mt-2 divide-y rounded border">
            {pastPayments.map((p) => {
              const delta = (p.actualAmountMinor ?? p.expectedAmountMinor) - p.expectedAmountMinor;
              return (
                <li key={p.id} className="flex justify-between px-4 py-2 text-sm tabular-nums">
                  <span>{p.dueDate.toISOString().slice(0, 10)}</span>
                  <span>
                    {formatMinorUnits(p.actualAmountMinor ?? p.expectedAmountMinor, currency)}
                    {delta !== 0 ? (
                      <span className={delta > 0 ? "ml-2 text-red-600" : "ml-2 text-green-700"}>
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

      <form action={submitDeleteBill}>
        <input type="hidden" name="id" value={bill.id} />
        <button type="submit" className="rounded border border-red-600 px-3 py-1 text-sm text-red-600">
          Delete bill (and its payment log)
        </button>
        {errorForm === "bill" && error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>
        ) : null}
      </form>
    </main>
  );
}
