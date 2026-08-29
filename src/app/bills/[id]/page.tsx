import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, ExternalLink, Trash2 } from "lucide-react";
import {
  addScheduleEntry,
  deleteBill,
  markPaid,
  removeScheduleEntry,
  setBillCadence,
  setBillPaymentSource,
  setBillPaymentRail,
  setBillRoute,
  setBillSpendCategory,
  unmarkPaid,
  updateBillPayeeDetails,
} from "@/app/bills/actions";
import { CadenceForm } from "./cadence-form";
import { AddScheduleForm } from "./add-schedule-form";
import { SmartRewardRouter } from "@/components/bills/smart-reward-router";
import { SensitiveAccountNumber } from "@/components/bills/sensitive-account-number";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Catalogue, OwnerState } from "@/engine/cards-twin";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { FxRateInput } from "@/engine/fx";
import { formatMinorUnits, type Currency } from "@/engine/money";
import type { Cadence, ScheduleEntry } from "@/engine/recurrence";
import { computeBillAllocation, type BillAllocationResult } from "@/lib/domain/bills/billAllocationSummary";
import { billSpendCategoryOptions, recommendCardForBill, type BillRecommendationResult } from "@/lib/domain/bills/cardForBill";
import { buildBillRouteWallet } from "@/lib/domain/bills/billRouteWallet";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { accountNumberLastFour, maskBillAccountNumber } from "@/lib/domain/bills/accountNumber";
import {
  BILL_PARENT_CATEGORIES,
  formatBillCategoryLabel,
  resolveBillTaxonomy,
} from "@/lib/taxonomy/billTaxonomy";

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
  const { railFeeCad, netValueAfterFeeCad } = rec;

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

      {railFeeCad > 0 ? (
        <p className="text-xs text-muted-foreground">
          Paid through a third-party service: {formatMinorUnits(Math.round(railFeeCad * 100), "CAD")} in fees comes
          off {formatMinorUnits(Math.round(winner.netValueCad * 100), "CAD")} of rewards, so this occurrence is
          worth {formatMinorUnits(Math.round(netValueAfterFeeCad * 100), "CAD")} more than paying it from a bank
          account.
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

  const [bill, ownerStateRecord, fxRatesRaw, ownedCards, bankAccounts] = await Promise.all([
    prisma.bill.findFirst({ where: { id, userId }, include: { payments: true } }),
    ensureOwnerStateRecord(prisma, userId),
    prisma.fxRate.findMany({ where: { userId, asOf: { lte: now } }, orderBy: [{ quote: "asc" }, { asOf: "desc" }] }),
    prisma.creditCard.findMany({ where: { userId }, select: { id: true, nickname: true, contractCardId: true, lastFour: true }, orderBy: { nickname: "asc" } }),
    prisma.financialAccount.findMany({
      where: { userId, type: { in: ["CHEQUING", "CASH"] } },
      select: { id: true, name: true, institution: true },
      orderBy: [{ institution: "asc" }, { name: "asc" }],
    }),
  ]);
  if (!bill) notFound();

  const ownerState = ownerStateRecord ? (ownerStateRecord.stateData as unknown as OwnerState) : null;
  const routeWalletCards = buildBillRouteWallet(
    catalogue,
    ownerState,
    ownedCards,
    now.toISOString().slice(0, 10),
  );
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
    {
        category: bill.category,
        currency: bill.currency,
        variable: bill.variable,
        paymentRail: bill.paymentRail,
        railFeePct: bill.railFeePct === null ? null : Number(bill.railFeePct),
      },
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
  const accountLastFour = bill.accountNumberLast4 ?? (bill.accountNumber ? accountNumberLastFour(bill.accountNumber) : null);
  const maskedAccountNumber = maskBillAccountNumber(accountLastFour);

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

  async function submitSetCadence(formData: FormData) {
    "use server";
    const result = await setBillCadence(formData);
    if (!result.ok) redirect(billErrorPath(id, "cadence", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitSetPaymentRail(formData: FormData) {
    "use server";
    const result = await setBillPaymentRail(formData);
    if (!result.ok) redirect(billErrorPath(id, "paymentRail", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitSetPaymentSource(formData: FormData) {
    "use server";
    const result = await setBillPaymentSource(formData);
    if (!result.ok) redirect(billErrorPath(id, "paymentSource", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitSetBillRoute(formData: FormData) {
    "use server";
    const result = await setBillRoute(formData);
    if (!result.ok) redirect(billErrorPath(id, "billRoute", result.error));
    redirect(`/bills/${id}`);
  }

  async function submitUpdatePayeeDetails(formData: FormData) {
    "use server";
    const result = await updateBillPayeeDetails(formData);
    if (!result.ok) redirect(billErrorPath(id, "payeeDetails", result.error));
    redirect(`/bills/${id}`);
  }

  const cadenceSummary =
    def.cadence.type === "MONTHLY"
      ? `Monthly (day ${def.cadence.dayOfMonth})`
      : def.cadence.type === "BIWEEKLY"
        ? `Biweekly (anchor ${def.cadence.anchor})`
        : def.cadence.type === "QUARTERLY"
          ? `Quarterly (anchor ${def.cadence.anchor})`
          : `Annual (anchor ${def.cadence.anchor})`;

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
            <Badge variant="outline" className="text-xs font-semibold">
              {formatBillCategoryLabel(bill.category)}
            </Badge>
            {bill.autopay ? <Badge variant="secondary">autopay</Badge> : null}
            {bill.variable ? <Badge variant="info">variable</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {resolveBillTaxonomy(bill.category).formattedLabel} · {cadenceSummary}
            {bill.payee ? ` · Payee: ${bill.payee}` : ""}
            {maskedAccountNumber ? ` · Acct: ${maskedAccountNumber}` : ""} · {bill.currency}
            {bill.autopay ? " · autopay" : ""}
            {bill.variable ? " · variable" : ""}
            {bill.prepaymentMonthDay ? ` · prepayment window ${bill.prepaymentMonthDay}` : ""}
            {bill.interestRatePct !== null ? ` · ${Number(bill.interestRatePct)}%` : ""}
          </p>
          {bill.notes ? <p className="mt-2 text-xs text-foreground/80 rounded-lg bg-muted/40 p-2.5">{bill.notes}</p> : null}
        </header>
      </div>

      {/* Payee & Account Details Card */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Payee &amp; Account Details</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Account identifiers are encrypted and stay masked until you explicitly reveal them.
            </p>
          </div>
        </div>

        <form action={submitUpdatePayeeDetails} className="mt-4 space-y-4">
          <input type="hidden" name="billId" value={bill.id} />
          <input type="hidden" name="paymentsCanadaCcin" value={bill.paymentsCanadaCcin ?? ""} />

          {bill.paymentsCanadaCcin ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" />
              <span>
                Biller identity verified with Payments Canada{bill.billerVerificationEnv === "sandbox" ? " sandbox" : ""} · CCIN {bill.paymentsCanadaCcin}
              </span>
            </div>
          ) : null}

          {maskedAccountNumber ? (
            <SensitiveAccountNumber
              billId={bill.id}
              masked={maskedAccountNumber}
              label={bill.accountNumberLabel}
            />
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-payee">
                Payee Name
              </label>
              <input
                id="edit-bill-payee"
                name="payee"
                defaultValue={bill.payee ?? ""}
                placeholder="e.g. DURHAM WATER, REG MUN OF"
                className={inputStyle}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-name">
                Nickname / Bill Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-bill-name"
                name="name"
                required
                defaultValue={bill.name}
                placeholder="e.g. Water (Durham Region)"
                className={inputStyle}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-category">
                Bill Type / Category
              </label>
              <select
                id="edit-bill-category"
                name="category"
                defaultValue={bill.category}
                className={inputStyle}
              >
                {BILL_PARENT_CATEGORIES.map((parent) => (
                  <optgroup key={parent.id} label={`${parent.icon} ${parent.label}`}>
                    {parent.subcategories.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-kind">
                Record type
              </label>
              <select id="edit-bill-kind" name="billerKind" defaultValue={bill.billerKind} className={inputStyle}>
                <option value="REGISTERED_BILLER">Payments Canada registered biller</option>
                <option value="SERVICE">Subscription or recurring service</option>
                <option value="CUSTOM">Custom/manual obligation</option>
              </select>
              {bill.paymentsCanadaCcin ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Choose service or custom to remove the verification link.
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-account-label">
                Identifier type
              </label>
              <input
                id="edit-bill-account-label"
                name="accountNumberLabel"
                defaultValue={bill.accountNumberLabel ?? "Customer / account number"}
                placeholder="Policy number, roll number, loan number…"
                className={inputStyle}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-account">
                {maskedAccountNumber ? "Replace complete account identifier" : "Complete account identifier"}
              </label>
              <input
                id="edit-bill-account"
                name="accountNumber"
                type="password"
                autoComplete="off"
                placeholder={maskedAccountNumber ? `Leave blank to keep ${maskedAccountNumber}` : "Stored encrypted after saving"}
                className={`${inputStyle} font-mono`}
              />
              {maskedAccountNumber ? (
                <label className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input type="checkbox" name="clearAccountNumber" value="true" className="size-3.5 rounded" />
                  Remove the stored account identifier
                </label>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-login-identifier">
                Login email or username
              </label>
              <input
                id="edit-bill-login-identifier"
                name="loginIdentifier"
                defaultValue={bill.loginIdentifier ?? ""}
                autoComplete="username"
                placeholder="billing@example.com"
                className={inputStyle}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-credential-location">
                Password saved in
              </label>
              <input
                id="edit-bill-credential-location"
                name="credentialLocation"
                defaultValue={bill.credentialLocation ?? ""}
                placeholder="iCloud Passwords, 1Password, Chrome…"
                className={inputStyle}
              />
              <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                Record the location only—never the password.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-service-url">
                Company or account URL
              </label>
              <div className="flex gap-2">
                <input
                  id="edit-bill-service-url"
                  name="serviceUrl"
                  type="url"
                  defaultValue={bill.serviceUrl ?? ""}
                  placeholder="https://company.example/account"
                  className={inputStyle}
                />
                {bill.serviceUrl ? (
                  <Button asChild type="button" variant="outline" size="icon">
                    <a href={bill.serviceUrl} target="_blank" rel="noreferrer" aria-label="Open company account page">
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <details className="sm:col-span-2 border-t border-border/60 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Login, billing and cancellation links
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-login-url">Login URL</label>
                  <input id="edit-bill-login-url" name="loginUrl" type="url" defaultValue={bill.loginUrl ?? ""} className={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-billing-url">Billing URL</label>
                  <input id="edit-bill-billing-url" name="billingUrl" type="url" defaultValue={bill.billingUrl ?? ""} className={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-cancellation-url">Cancellation URL</label>
                  <input id="edit-bill-cancellation-url" name="cancellationUrl" type="url" defaultValue={bill.cancellationUrl ?? ""} className={inputStyle} />
                </div>
              </div>
            </details>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1" htmlFor="edit-bill-notes">
                Notes
              </label>
              <textarea
                id="edit-bill-notes"
                name="notes"
                rows={2}
                defaultValue={bill.notes ?? ""}
                placeholder="Plan details, promotion expiry, cancellation notice period…"
                className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            {errorForm === "payeeDetails" && error ? (
              <p className="text-xs font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : <span />}

            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shadow-2xs"
            >
              Save Payee &amp; Account Details
            </button>
          </div>
        </form>
      </section>

      {/* Pay With Recommendation */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Pay with</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Which of your cards earns the most on this bill&apos;s next charge.
        </p>
        <BillCardRecommendationPanel rec={cardRec} />

        <form action={submitSetBillRoute} className="mt-4 space-y-3">
          <input type="hidden" name="billId" value={bill.id} />
          <SmartRewardRouter
            payeeName={bill.payee || bill.name}
            monthlyCad={upcoming[0] ? upcoming[0].amountMinor / 100 : 0}
            ownedCards={routeWalletCards}
            selectedRouteId={bill.selectedRouteId ?? undefined}
          />
          <div className="flex items-center justify-between gap-3">
            {errorForm === "billRoute" && error ? (
              <p className="text-xs font-medium text-red-600" role="alert">{error}</p>
            ) : <span />}
            <Button type="submit" variant="outline" size="sm">Save route</Button>
          </div>
        </form>

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
              How it can be paid
            </p>
            <form action={submitSetPaymentRail} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="billId" value={bill.id} />
              <select name="paymentRail" defaultValue={bill.paymentRail} className={`${inputStyle} max-w-64`}>
                <option value="unknown">Not sure yet</option>
                <option value="card">Credit card accepted directly</option>
                <option value="pad">Bank account only (pre-authorized debit)</option>
                <option value="card_via_third_party">Card only via a third-party service (fee)</option>
              </select>
              <input
                type="number"
                name="railFeePct"
                step="0.01"
                min="0"
                max="100"
                placeholder="Fee %"
                defaultValue={bill.railFeePct === null ? "" : String(Number(bill.railFeePct))}
                className={`${inputStyle} max-w-28`}
                aria-label="Third-party service fee, percent"
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Save
              </button>
            </form>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Decides whether a card can pay this bill at all — separate from its category. The fee applies
              only to the third-party option, and without it no card is suggested.
            </p>
            {errorForm === "paymentRail" && error ? (
              <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Paid from
            </p>
            {ownedCards.length === 0 && bankAccounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No cards or bank accounts are available yet.{" "}
                <Link href="/investments/new" className="underline hover:text-foreground">
                  Add an account
                </Link>{" "}
                or add a card to record the source.
              </p>
            ) : (
              <form action={submitSetPaymentSource} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="billId" value={bill.id} />
                <select
                  name="paymentSource"
                  defaultValue={
                    bill.paymentCardId
                      ? `card:${bill.paymentCardId}`
                      : bill.sourceAccountId
                        ? `account:${bill.sourceAccountId}`
                        : ""
                  }
                  className={`${inputStyle} max-w-64`}
                >
                  <option value="">Not recorded</option>
                  {ownedCards.length > 0 ? (
                    <optgroup label="Cards">
                      {ownedCards.map((card) => (
                        <option key={card.id} value={`card:${card.id}`}>
                          {card.nickname}{card.lastFour ? ` · •••• ${card.lastFour}` : ""}
                          {card.contractCardId ? "" : " (not linked to catalogue)"}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {bankAccounts.length > 0 ? (
                    <optgroup label="Bank accounts">
                      {bankAccounts.map((account) => (
                        <option key={account.id} value={`account:${account.id}`}>
                          {account.institution} · {account.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  Save
                </button>
              </form>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Records where the money comes from. Choosing a source clears any previously saved smart route.
            </p>
            {errorForm === "paymentSource" && error ? (
              <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <BillAllocationStatusPanel allocation={allocation} allocatedCardName={allocatedCard?.nickname ?? null} />
          </div>
        </div>
      </section>

      {/* Payment Cadence Section */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Payment cadence</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Controls the recurring payment due dates generated in the forecast and 12-month checklist.
        </p>
        <div className="mt-4">
          <CadenceForm
            billId={bill.id}
            initialCadence={def.cadence}
            action={submitSetCadence}
            error={errorForm === "cadence" ? error : undefined}
          />
        </div>
      </section>

      {/* Amount Schedule Section */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Amount schedule</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Define pricing amounts and promo/discount steps over time. (Payment dates are determined by the Cadence above).
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
          <AddScheduleForm
            billId={bill.id}
            currency={currency}
            action={submitAddSchedule}
            error={errorForm === "schedule" ? error : undefined}
          />
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
