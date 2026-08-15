import { Save, Trash2 } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import {
  addHolding,
  addSnapshot,
  addTransaction,
  deleteAccount,
  deleteHolding,
  deleteSnapshot,
  deleteTransaction,
  updateAccount,
  updateTransaction,
} from "@/app/investments/actions";
import { accountBalanceWithCurrency, holdingValueMinor } from "@/engine/balance";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const TX_TYPES = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"] as const;
const ACCOUNT_TYPES = ["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"] as const;

function accountErrorPath(accountId: string, form: string, message: string) {
  return `/investments/${accountId}?errorForm=${form}&error=${encodeURIComponent(message)}`;
}

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; errorForm?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { error, errorForm } = await searchParams;
  const account = await prisma.financialAccount.findFirst({
    where: { id, userId },
    include: {
      holdings: { orderBy: { symbol: "asc" } },
      transactions: { orderBy: { date: "desc" } },
      snapshots: { orderBy: { asOf: "desc" }, take: 20 },
    },
  });
  if (!account) notFound();

  const currency = account.currency as Currency;
  const snapshotInputs = account.snapshots.map((s) => ({
    balanceMinor: s.balanceMinor,
    currency: s.currency as Currency,
    asOf: s.asOf.toISOString(),
  }));
  const balance = accountBalanceWithCurrency(
    account.transactions.map((t) => ({
      type: t.type,
      amountMinor: t.amountMinor,
      date: t.date.toISOString(),
      currency: t.currency,
    })),
    snapshotInputs,
    currency,
  );
  const holdingsValue = account.holdings.reduce(
    (sum, h) => sum + holdingValueMinor(Number(h.quantity), h.lastPriceMinor),
    0,
  );
  const displayedTransactions = account.transactions.slice(0, 50);

  async function submitHolding(formData: FormData) {
    "use server";
    const result = await addHolding(formData);
    if (!result.ok) redirect(accountErrorPath(id, "holding", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitAccount(formData: FormData) {
    "use server";
    const result = await updateAccount(formData);
    if (!result.ok) redirect(accountErrorPath(id, "account", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitDeleteHolding(formData: FormData) {
    "use server";
    const result = await deleteHolding(formData);
    if (!result.ok) redirect(accountErrorPath(id, "holding", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitTransaction(formData: FormData) {
    "use server";
    const result = await addTransaction(formData);
    if (!result.ok) redirect(accountErrorPath(id, "transaction", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitUpdateTransaction(formData: FormData) {
    "use server";
    const result = await updateTransaction(formData);
    if (!result.ok) redirect(accountErrorPath(id, "transaction", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitDeleteTransaction(formData: FormData) {
    "use server";
    const result = await deleteTransaction(formData);
    if (!result.ok) redirect(accountErrorPath(id, "transaction", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitSnapshot(formData: FormData) {
    "use server";
    const result = await addSnapshot(formData);
    if (!result.ok) redirect(accountErrorPath(id, "snapshot", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitDeleteSnapshot(formData: FormData) {
    "use server";
    const result = await deleteSnapshot(formData);
    if (!result.ok) redirect(accountErrorPath(id, "snapshot", result.error));
    redirect(`/investments/${id}`);
  }

  async function submitDelete(formData: FormData) {
    "use server";
    const result = await deleteAccount(formData);
    if (!result.ok) redirect(accountErrorPath(id, "delete", result.error));
    redirect("/investments");
  }

  return (
    <main className="space-y-8 py-8">
      <header>
        <h1 className="text-xl font-semibold">{account.name}</h1>
        <p className="text-sm text-muted-foreground">
          {account.type} · {account.institution} · {account.currency}
        </p>
        <p className="mt-2 text-2xl tabular-nums">
          {balance.ok ? formatMinorUnits(balance.balanceMinor, balance.currency as Currency) : "Balance unavailable"}
          {balance.ok ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {balance.source === "snapshot"
                ? `snapshot ${balance.asOf?.slice(0, 10)} · ${balance.currency}`
                : "derived from transactions"}
            </span>
          ) : null}
        </p>
        {!balance.ok ? <p className="mt-1 text-sm text-red-600">{balance.error}</p> : null}
        {account.holdings.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Holdings market value: {formatMinorUnits(holdingsValue, currency)}
          </p>
        ) : null}
      </header>

      <section>
        <h2 className="font-medium">Account details</h2>
        <form action={submitAccount} className="mt-3 grid max-w-2xl grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <input type="hidden" name="accountId" value={account.id} />
          <input name="name" defaultValue={account.name} required aria-label="Account name" className="rounded border px-2 py-1" />
          <input name="institution" defaultValue={account.institution} required aria-label="Institution" className="rounded border px-2 py-1" />
          <select name="type" defaultValue={account.type} required aria-label="Account type" className="rounded border px-2 py-1">
            {ACCOUNT_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
          <input name="country" defaultValue={account.country} required pattern="[A-Z]{2}" aria-label="Country" className="rounded border px-2 py-1" />
          <input name="currency" value={account.currency} readOnly aria-label="Currency" className="rounded border bg-muted px-2 py-1" />
          <label className="flex items-center gap-2 rounded border px-2 py-1">
            <input type="checkbox" name="isUSSitus" value="true" defaultChecked={account.isUSSitus} /> US-situs
          </label>
          <button type="submit" className="col-span-2 inline-flex items-center justify-center gap-2 rounded border px-2 py-1 sm:col-span-3">
            <Save className="size-4" aria-hidden="true" /> Save account
          </button>
        </form>
        {errorForm === "account" && error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
      </section>

      <section>
        <h2 className="font-medium">Holdings</h2>
        <ul className="mt-2 divide-y rounded border">
          {account.holdings.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span>
                {h.symbol} <span className="text-muted-foreground">{h.name} · {h.domicileCountry}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">
                  {Number(h.quantity)} × {formatMinorUnits(h.lastPriceMinor, currency)} ={" "}
                  {formatMinorUnits(holdingValueMinor(Number(h.quantity), h.lastPriceMinor), currency)}
                </span>
                <form action={submitDeleteHolding}>
                  <input type="hidden" name="holdingId" value={h.id} />
                  <button type="submit" aria-label={`Delete ${h.symbol} holding`} title="Delete holding" className="text-red-600">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
        <form action={submitHolding} className="mt-3 grid max-w-2xl grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <input type="hidden" name="accountId" value={account.id} />
          <input name="symbol" placeholder="Symbol" required className="rounded border px-2 py-1" />
          <input name="name" placeholder="Name" required className="rounded border px-2 py-1" />
          <input name="domicileCountry" placeholder="Domicile (CA)" required pattern="[A-Z]{2}" className="rounded border px-2 py-1" />
          <input name="quantity" placeholder="Quantity" required className="rounded border px-2 py-1" />
          <input name="lastPriceMinor" placeholder="Price (cents)" required className="rounded border px-2 py-1" />
          <input name="priceAsOf" type="date" required className="rounded border px-2 py-1" />
          <button type="submit" className="col-span-2 rounded border px-2 py-1 sm:col-span-3">
            Add / update holding
          </button>
        </form>
        {errorForm === "holding" && error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
      </section>

      <section>
        <h2 className="font-medium">Log a transaction</h2>
        <form action={submitTransaction} className="mt-3 grid max-w-2xl grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <input type="hidden" name="accountId" value={account.id} />
          <select name="type" className="rounded border px-2 py-1">
            {TX_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input name="amountMinor" placeholder="Amount (cents)" required className="rounded border px-2 py-1" />
          <input name="date" type="date" required className="rounded border px-2 py-1" />
          <input name="description" placeholder="Description" className="rounded border px-2 py-1" />
          {account.type === "ROTH_IRA" ? (
            <label className="col-span-2 flex items-center gap-2 text-xs text-red-600 sm:col-span-4">
              <input type="checkbox" name="confirmRoth" value="true" />
              I understand a contribution while Canadian-resident may permanently taint the Roth treaty election.
            </label>
          ) : null}
          <button type="submit" className="col-span-2 rounded border px-2 py-1 sm:col-span-4">
            Add transaction
          </button>
        </form>
        <ul className="mt-3 divide-y rounded border">
          {displayedTransactions.map((t) => (
            <li key={t.id} className="px-4 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {t.date.toISOString().slice(0, 10)} {t.type}
                  {t.description ? <span className="text-muted-foreground"> · {t.description}</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMinorUnits(t.amountMinor, t.currency as Currency)}</span>
                  <form action={submitDeleteTransaction}>
                    <input type="hidden" name="transactionId" value={t.id} />
                    <button type="submit" aria-label={`Delete ${t.type.toLowerCase()} transaction`} title="Delete transaction" className="text-red-600">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </form>
                </span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Edit transaction</summary>
                <form action={submitUpdateTransaction} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input type="hidden" name="transactionId" value={t.id} />
                  <select name="type" defaultValue={t.type} aria-label="Transaction type" className="rounded border px-2 py-1">
                    {TX_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <input name="amountMinor" defaultValue={t.amountMinor} required aria-label="Amount in cents" className="rounded border px-2 py-1" />
                  <input name="date" type="date" defaultValue={t.date.toISOString().slice(0, 10)} required aria-label="Transaction date" className="rounded border px-2 py-1" />
                  <input name="description" defaultValue={t.description ?? ""} aria-label="Description" className="rounded border px-2 py-1" />
                  <button type="submit" className="col-span-2 inline-flex items-center justify-center gap-2 rounded border px-2 py-1 sm:col-span-4">
                    <Save className="size-4" aria-hidden="true" /> Save transaction
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
        {errorForm === "transaction" && error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
      </section>

      <section>
        <h2 className="font-medium">Balance snapshots</h2>
        <form action={submitSnapshot} className="mt-3 flex max-w-md gap-2 text-sm">
          <input type="hidden" name="accountId" value={account.id} />
          <input name="balanceMinor" placeholder="Balance (cents)" required className="flex-1 rounded border px-2 py-1" />
          <input name="asOf" type="date" required className="rounded border px-2 py-1" />
          <button type="submit" className="rounded border px-2 py-1">
            Snapshot
          </button>
        </form>
        <ul className="mt-3 divide-y rounded border">
          {account.snapshots.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span>{s.asOf.toISOString().slice(0, 10)}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatMinorUnits(s.balanceMinor, s.currency as Currency)}</span>
                <form action={submitDeleteSnapshot}>
                  <input type="hidden" name="snapshotId" value={s.id} />
                  <button type="submit" aria-label={`Delete ${s.asOf.toISOString().slice(0, 10)} snapshot`} title="Delete snapshot" className="text-red-600">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
        {errorForm === "snapshot" && error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
      </section>

      <form action={submitDelete}>
        <input type="hidden" name="id" value={account.id} />
        <button type="submit" className="rounded border border-red-600 px-3 py-1 text-sm text-red-600">
          Delete account (and all its data)
        </button>
        {errorForm === "delete" && error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
