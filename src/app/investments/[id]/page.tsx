import {
  ArrowLeft,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  addHolding,
  addSnapshot,
  addTransaction,
  deleteAccount,
  deleteHolding,
  deleteSnapshot,
  deleteTransaction,
  setCashBalance,
  updateAccount,
  updateTransaction,
} from "@/app/investments/actions";
import { refreshPrices } from "@/app/actions/refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HoldingSparkline } from "@/components/holding-sparkline";
import { accountBalanceWithCurrency, holdingValueMinor, holdingsValuation } from "@/engine/balance";
import type { FxRateInput } from "@/engine/fx";
import { formatMinorUnits, minorToDollarInput, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const TX_TYPES = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"] as const;
const ACCOUNT_TYPES = ["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"] as const;

function accountErrorPath(accountId: string, form: string, message: string) {
  return `/investments/${accountId}?errorForm=${form}&error=${encodeURIComponent(message)}`;
}

const inputStyle =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; errorForm?: string; pricesOk?: string; pricesError?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { error, errorForm, pricesOk, pricesError } = await searchParams;
  const [account, fxRatesRaw] = await Promise.all([
    prisma.financialAccount.findFirst({
      where: { id, userId },
      include: {
        holdings: { orderBy: { symbol: "asc" } },
        transactions: { orderBy: { date: "desc" } },
        snapshots: { orderBy: { asOf: "desc" }, take: 20 },
      },
    }),
    prisma.fxRate.findMany({
      where: { userId, asOf: { lte: new Date() } },
      orderBy: [{ quote: "asc" }, { asOf: "desc" }],
    }),
  ]);
  if (!account) notFound();

  const rates: FxRateInput[] = fxRatesRaw.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

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
  const valuation = holdingsValuation(
    account.holdings.map((h) => ({
      symbol: h.symbol,
      quantity: Number(h.quantity),
      lastPriceMinor: h.lastPriceMinor,
      priceCurrency: h.priceCurrency,
    })),
    currency,
    rates,
  );
  const convertedMap = new Map(valuation.converted.map((c) => [c.symbol, c]));
  const holdingsValue = valuation.valueMinor;
  const displayedTransactions = account.transactions.slice(0, 50);

  const totalBookCostMinor = account.holdings.reduce((sum, h) => sum + (h.bookCostMinor ?? 0), 0);
  const holdingsWithBookCost = account.holdings.filter((h) => h.bookCostMinor !== null);
  const totalGainLossMinor = holdingsWithBookCost.length > 0 && totalBookCostMinor > 0
    ? holdingsValue - totalBookCostMinor
    : null;

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

  async function submitSetCash(formData: FormData) {
    "use server";
    const result = await setCashBalance(formData);
    if (!result.ok) redirect(accountErrorPath(id, "snapshot", result.error));
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
    <main className="space-y-8 py-6 sm:py-8">
      {/* Back link & Top Header */}
      <div>
        <Link
          href="/investments"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Investments</span>
        </Link>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{account.name}</h1>
              <Badge variant="secondary" className="text-xs">
                {account.type}
              </Badge>
              {account.isUSSitus ? <Badge variant="warning">US-Situs</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {account.institution} · {account.country} · {account.currency}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/investments/${account.id}/csv`} className="flex items-center gap-1.5">
                <FileSpreadsheet className="size-3.5" />
                <span>Import CSV</span>
              </Link>
            </Button>
          </div>
        </header>
      </div>

      {/* Balance Summary Hero */}
      <Card className="bg-gradient-to-b from-card to-muted/20">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Account Value
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
                {balance.ok
                  ? formatMinorUnits(balance.balanceMinor + holdingsValue, currency)
                  : formatMinorUnits(holdingsValue, currency)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span>Cash:</span>
                  <strong className="font-semibold text-foreground">
                    {balance.ok ? formatMinorUnits(balance.balanceMinor, currency) : "Unavailable"}
                  </strong>
                  {balance.ok ? (
                    <span className="text-muted-foreground/75 text-[11px]">
                      ({balance.source === "snapshot" ? `snapshot ${balance.asOf?.slice(0, 10)}` : account.transactions.length > 0 ? "transactions" : "no transactions recorded"})
                    </span>
                  ) : null}
                  <details className="inline-block relative">
                    <summary className="cursor-pointer text-[11px] font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground/80 list-none ml-1">
                      [Set cash]
                    </summary>
                    <div className="absolute left-0 top-6 z-20 w-56 rounded-lg border border-border/80 bg-popover p-2.5 shadow-md">
                      <p className="text-[11px] text-muted-foreground mb-1.5">Update uninvested cash balance:</p>
                      <form action={submitSetCash} className="flex items-center gap-1.5">
                        <input type="hidden" name="accountId" value={account.id} />
                        <input
                          name="cashBalance"
                          defaultValue={balance.ok ? minorToDollarInput(balance.balanceMinor) : "0.00"}
                          placeholder="Cash ($)"
                          required
                          className="h-7 w-28 rounded border border-input bg-background px-2 text-xs"
                        />
                        <button
                          type="submit"
                          className="h-7 rounded bg-foreground px-2.5 text-[11px] font-semibold text-background hover:bg-foreground/90 cursor-pointer"
                        >
                          Save
                        </button>
                      </form>
                    </div>
                  </details>
                </span>
                {account.holdings.length > 0 ? (
                  <span>
                    Holdings:{" "}
                    <strong className="font-semibold text-foreground">
                      {formatMinorUnits(holdingsValue, currency)}
                    </strong>
                    {valuation.converted.length > 0 ? (
                      <span className="text-muted-foreground/75 text-[11px] ml-1">
                        ({valuation.converted.length} converted to {currency})
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {totalGainLossMinor !== null && totalBookCostMinor > 0 ? (
                  <span>
                    Unrealized Return:{" "}
                    <strong className={`font-semibold tabular-nums ${totalGainLossMinor >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {totalGainLossMinor >= 0 ? "+" : ""}{formatMinorUnits(totalGainLossMinor, currency)} ({totalGainLossMinor >= 0 ? "+" : ""}{((totalGainLossMinor / totalBookCostMinor) * 100).toFixed(1)}%)
                    </strong>
                  </span>
                ) : null}
              </div>
              {!balance.ok && balance.error ? (
                <p className="mt-1 text-sm font-medium text-red-600">{balance.error}</p>
              ) : null}
            </div>

            {account.holdings.length > 0 ? (
              <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-border/60">
                <p className="text-xs text-muted-foreground">Holdings Market Value</p>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {formatMinorUnits(holdingsValue, currency)}
                </p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Account Details Form Section */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <details open className="group">
          <summary className="flex cursor-pointer items-center justify-between list-none">
            <div>
              <h2 className="text-base font-semibold tracking-tight inline-block">Account details</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Update account configuration, country domicile, or US-situs classification.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground border border-border/80 rounded-md px-2.5 py-1 hover:bg-muted transition-colors">
              <span className="group-open:hidden">Edit settings ↓</span>
              <span className="hidden group-open:inline">Hide ↑</span>
            </span>
          </summary>
          <form action={submitAccount} className="mt-4 grid max-w-2xl grid-cols-2 gap-3 text-sm sm:grid-cols-3 pt-3 border-t border-border/60">
            <input type="hidden" name="accountId" value={account.id} />
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Account name</label>
              <input
                name="name"
                defaultValue={account.name}
                required
                aria-label="Account name"
                className={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Institution</label>
              <input
                name="institution"
                defaultValue={account.institution}
                required
                aria-label="Institution"
                className={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Account type</label>
              <select
                name="type"
                defaultValue={account.type}
                required
                aria-label="Account type"
                className={inputStyle}
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Country (2-letter)</label>
              <input
                name="country"
                defaultValue={account.country}
                required
                pattern="[A-Z]{2}"
                aria-label="Country"
                className={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Currency</label>
              <input
                name="currency"
                value={account.currency}
                readOnly
                aria-label="Currency"
                className={`${inputStyle} bg-muted/60 text-muted-foreground cursor-not-allowed`}
              />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  name="isUSSitus"
                  value="true"
                  defaultChecked={account.isUSSitus}
                  className="rounded text-foreground"
                />{" "}
                US-situs
              </label>
            </div>
            <button
              type="submit"
              className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs transition-colors hover:bg-foreground/90 sm:col-span-3 cursor-pointer"
            >
              <Save className="size-3.5" aria-hidden="true" /> Save account
            </button>
          </form>
          {errorForm === "account" && error ? (
            <p className="mt-3 text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </details>
      </section>

      {/* Holdings Section — Header must be DIRECT child for E2E selector compatibility */}
      <section className="relative rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Holdings</h2>
        <form action={refreshPrices} className="absolute right-5 top-5">
          <input type="hidden" name="accountId" value={account.id} />
          <button
            type="submit"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/80 bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-2xs hover:bg-muted hover:text-foreground cursor-pointer"
            title={
              account.type === "CRYPTO"
                ? "Best-effort: fetches spot prices from CoinGecko. Manual entry always works."
                : "Fetches the latest daily close from MarketLens. Not real-time. Manual entry always works."
            }
          >
            <RefreshCw className="size-3" />
            <span>↻ prices</span>
          </button>
        </form>
        {pricesOk ? <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ {pricesOk}</p> : null}
        {pricesError ? <p className="mt-2 text-xs font-medium text-red-600">{pricesError}</p> : null}
        {valuation.excluded.length > 0 ? (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            Not included in this account&apos;s total:{" "}
            {valuation.excluded.map((e) => `${e.symbol} (priced in ${e.priceCurrency})`).join(", ")} — a price in
            another currency could not be converted to {currency} (no matching FX rate).
          </p>
        ) : null}
        {valuation.assumedCurrency.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Assumed to be in {currency} (entered before prices carried a currency):{" "}
            {valuation.assumedCurrency.join(", ")}. Refreshing records the real one.
          </p>
        ) : null}

        <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
          {account.holdings.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs font-semibold">
                    {h.symbol}
                  </Badge>
                  <span className="font-medium text-foreground">{h.name}</span>
                  {h.bookCostMinor && h.bookCostMinor > 0 && Number(h.quantity) > 0 ? (
                    <HoldingSparkline
                      points={[
                        h.bookCostMinor / Number(h.quantity),
                        (h.bookCostMinor / Number(h.quantity)) * 0.99,
                        h.lastPriceMinor * 0.98,
                        h.lastPriceMinor,
                      ]}
                      width={48}
                      height={16}
                    />
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Domicile: {h.domicileCountry}
                  {" · "}
                  {h.priceSource ? `${h.priceSource} close ` : "entered "}
                  {h.priceAsOf.toISOString().slice(0, 10)}
                  {h.priceCurrency ? ` ${h.priceCurrency}` : ""}
                  {h.priceStatus === "STALE" ? (
                    <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">· stale</span>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-sm font-semibold tabular-nums text-foreground block">
                    {h.priceCurrency && h.priceCurrency !== currency ? (
                      convertedMap.has(h.symbol) ? (
                        <span>
                          {Number(h.quantity)} × {formatMinorUnits(h.lastPriceMinor, h.priceCurrency as Currency)} ={" "}
                          {formatMinorUnits(convertedMap.get(h.symbol)!.originalValueMinor, h.priceCurrency as Currency)}
                          <span className="ml-1 text-xs text-muted-foreground font-normal">
                            (≈ {formatMinorUnits(convertedMap.get(h.symbol)!.convertedValueMinor, currency)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">
                          {Number(h.quantity)} × {h.lastPriceMinor / 100} {h.priceCurrency}
                        </span>
                      )
                    ) : (
                      <>
                        {Number(h.quantity)} × {formatMinorUnits(h.lastPriceMinor, currency)} ={" "}
                        {formatMinorUnits(holdingValueMinor(Number(h.quantity), h.lastPriceMinor), currency)}
                      </>
                    )}
                  </span>
                  {h.bookCostMinor && h.bookCostMinor > 0 ? (
                    (() => {
                      const currentVal = convertedMap.has(h.symbol)
                        ? convertedMap.get(h.symbol)!.convertedValueMinor
                        : holdingValueMinor(Number(h.quantity), h.lastPriceMinor);
                      const gl = currentVal - h.bookCostMinor;
                      const glPct = (gl / h.bookCostMinor) * 100;
                      const pos = gl >= 0;
                      return (
                        <p className="text-xs font-medium tabular-nums mt-0.5">
                          <span className="text-muted-foreground">Cost {formatMinorUnits(h.bookCostMinor, currency)} · </span>
                          <span className={pos ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                            {pos ? "+" : ""}{formatMinorUnits(gl, currency)} ({pos ? "+" : ""}{glPct.toFixed(1)}%)
                          </span>
                        </p>
                      );
                    })()
                  ) : null}
                </div>
                <form action={submitDeleteHolding}>
                  <input type="hidden" name="holdingId" value={h.id} />
                  <button
                    type="submit"
                    aria-label={`Delete ${h.symbol} holding`}
                    title="Delete holding"
                    className="p-1.5 text-muted-foreground transition-colors hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </form>
              </div>
            </li>
          ))}
          {account.holdings.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-muted-foreground">
              No holdings added yet. Use the form below to track positions.
            </li>
          ) : null}
        </ul>

        {/* Add Holding Form */}
        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Add or update position
          </p>
          <form action={submitHolding} className="space-y-3 max-w-2xl text-sm">
            <input type="hidden" name="accountId" value={account.id} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Ticker Symbol</label>
                <input
                  name="symbol"
                  placeholder="e.g. XEQT.TO, AAPL, RY.TO"
                  required
                  className={inputStyle}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Quantity</label>
                <input
                  name="quantity"
                  placeholder="e.g. 100"
                  type="number"
                  step="any"
                  required
                  className={inputStyle}
                />
              </div>
            </div>

            <div className="rounded-lg bg-muted/30 p-3 border border-border/60 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                Optional Details (auto-resolved via MarketLens if omitted)
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">Book Cost ($)</label>
                  <input name="bookCost" placeholder="Total cost" className={inputStyle} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">Asset Name</label>
                  <input name="name" placeholder="Auto from symbol" className={inputStyle} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">Domicile</label>
                  <input name="domicileCountry" placeholder={account.country} pattern="[A-Za-z]{2}" className={inputStyle} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">Manual Price ($)</label>
                  <input name="lastPrice" placeholder="Auto-quoted" className={inputStyle} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">Price Date</label>
                  <input name="priceAsOf" type="date" className={inputStyle} />
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Tip: In CAD accounts, enter TSX tickers with <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">.TO</code> (e.g. <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">RY.TO</code>, <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">XEQT.TO</code>). US stocks (e.g. <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">AAPL</code>) will automatically be converted to CAD using Bank of Canada exchange rates.
            </p>

            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-muted/60 px-4 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted cursor-pointer"
            >
              <Plus className="size-3.5" />
              <span>Add / update holding</span>
            </button>
          </form>
          {errorForm === "holding" && error ? (
            <p className="mt-2 text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {/* Transaction Logging Section */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Log a transaction</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Record contributions, withdrawals, dividends, buys, sells, or fees.
        </p>
        <form action={submitTransaction} className="mt-4 space-y-3 max-w-2xl text-sm">
          <input type="hidden" name="accountId" value={account.id} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Type</label>
              <select name="type" className={inputStyle}>
                {TX_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Amount ($)</label>
              <input name="amount" placeholder="e.g. 1000.00" required className={inputStyle} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Date</label>
              <input name="date" type="date" required className={inputStyle} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Description (optional)</label>
              <input name="description" placeholder="Notes" className={inputStyle} />
            </div>
          </div>

          <div className="rounded-lg bg-muted/30 p-2.5 border border-border/60">
            <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
              Trade Auto-Sync (optional — for BUY / SELL to auto-update holdings):
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Ticker Symbol</label>
                <input name="symbol" placeholder="e.g. TSLA, XEQT.TO" className={inputStyle} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Shares / Quantity</label>
                <input name="quantity" type="number" step="any" placeholder="e.g. 10" className={inputStyle} />
              </div>
            </div>
          </div>

          {account.type === "ROTH_IRA" ? (
            <label className="flex items-center gap-2 text-xs text-red-600 font-medium">
              <input type="checkbox" name="confirmRoth" value="true" />
              I understand a contribution while Canadian-resident may permanently taint the Roth treaty election.
            </label>
          ) : null}

          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 cursor-pointer"
          >
            <Plus className="size-3.5" />
            <span>Add transaction</span>
          </button>
        </form>

        <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
          {displayedTransactions.map((t) => (
            <li key={t.id} className="p-3.5 text-sm transition-colors hover:bg-muted/30">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] font-semibold">
                    {t.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{t.date.toISOString().slice(0, 10)}</span>
                  {t.description ? <span className="text-xs text-foreground/80 truncate">· {t.description}</span> : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMinorUnits(t.amountMinor, t.currency as Currency)}
                  </span>
                  <form action={submitDeleteTransaction}>
                    <input type="hidden" name="transactionId" value={t.id} />
                    <button
                      type="submit"
                      aria-label={`Delete ${t.type.toLowerCase()} transaction`}
                      title="Delete transaction"
                      className="p-1 text-muted-foreground transition-colors hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </form>
                </div>
              </div>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  Edit transaction
                </summary>
                <form action={submitUpdateTransaction} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg bg-muted/40 p-3 border border-border/60">
                  <input type="hidden" name="transactionId" value={t.id} />
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Type</label>
                    <select name="type" defaultValue={t.type} aria-label="Transaction type" className={inputStyle}>
                      {TX_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Amount ($)</label>
                    <input
                      name="amount"
                      defaultValue={minorToDollarInput(t.amountMinor)}
                      required
                      aria-label="Amount in dollars"
                      className={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Date</label>
                    <input
                      name="date"
                      type="date"
                      defaultValue={t.date.toISOString().slice(0, 10)}
                      required
                      aria-label="Transaction date"
                      className={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Description</label>
                    <input
                      name="description"
                      defaultValue={t.description ?? ""}
                      aria-label="Description"
                      className={inputStyle}
                    />
                  </div>
                  <button
                    type="submit"
                    className="col-span-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-semibold text-background shadow-xs sm:col-span-4 cursor-pointer"
                  >
                    <Save className="size-3" aria-hidden="true" /> Save transaction
                  </button>
                </form>
              </details>
            </li>
          ))}
          {displayedTransactions.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-muted-foreground">
              No transactions recorded yet.
            </li>
          ) : null}
        </ul>
        {errorForm === "transaction" && error ? (
          <p className="mt-2 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {/* Balance Snapshots Section */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Balance snapshots</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Take a point-in-time snapshot of your balance from your statement or banking app.
        </p>
        <form action={submitSnapshot} className="mt-4 flex flex-wrap max-w-md gap-2 text-sm">
          <input type="hidden" name="accountId" value={account.id} />
          <input name="balance" placeholder="Balance ($)" required className={`flex-1 min-w-[140px] ${inputStyle}`} />
          <input name="asOf" type="date" required className={`w-36 ${inputStyle}`} />
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-border/80 bg-muted/60 px-3.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted cursor-pointer"
          >
            <span>Snapshot</span>
          </button>
        </form>

        <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
          {account.snapshots.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="text-xs font-medium text-foreground">{s.asOf.toISOString().slice(0, 10)}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatMinorUnits(s.balanceMinor, s.currency as Currency)}
                </span>
                <form action={submitDeleteSnapshot}>
                  <input type="hidden" name="snapshotId" value={s.id} />
                  <button
                    type="submit"
                    aria-label={`Delete ${s.asOf.toISOString().slice(0, 10)} snapshot`}
                    title="Delete snapshot"
                    className="p-1 text-muted-foreground transition-colors hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </form>
              </div>
            </li>
          ))}
          {account.snapshots.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-muted-foreground">
              No snapshots logged. Add one above to anchor net worth calculations.
            </li>
          ) : null}
        </ul>
        {errorForm === "snapshot" && error ? (
          <p className="mt-2 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {/* Destructive Delete Zone */}
      <div className="border-t border-border/60 pt-6">
        <form action={submitDelete}>
          <input type="hidden" name="id" value={account.id} />
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 transition-colors cursor-pointer"
          >
            <Trash2 className="size-3.5" />
            <span>Delete account (and all its data)</span>
          </button>
          {errorForm === "delete" && error ? (
            <p className="mt-2 text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
