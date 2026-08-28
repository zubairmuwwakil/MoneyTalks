import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, PlusCircle, Receipt, ShieldCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createBill } from "@/app/bills/actions";
import type { Catalogue } from "@/engine/cards-twin";
import { billSpendCategoryOptions } from "@/lib/domain/bills/cardForBill";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { requireUserId } from "@/lib/require-user";
import { BillFormFields } from "./form-fields";

// Same module-level-singleton + cast precedent as src/app/bills/page.tsx —
// the catalogue JSON never changes at runtime, so the option list is
// derived once at module load, not per request.
const catalogue = cardCatalogue as unknown as Catalogue;
const spendCategoryOptions = billSpendCategoryOptions(catalogue);

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUserId();
  const { error } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const result = await createBill(formData);
    if (result.ok) redirect("/bills");
    redirect(`/bills/new?error=${encodeURIComponent(result.error)}`);
  }

  return (
    <main className="max-w-2xl mx-auto space-y-6 py-6 sm:py-8 px-4 sm:px-0">
      <div>
        <Link
          href="/bills"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors group"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Bills</span>
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Add New Bill</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Set up recurring cadence, calculate provincial sales tax, and optimize card rewards.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-medium text-red-600 dark:text-red-400 animate-shake"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <Card className="border-border/80 shadow-xs">
        <CardHeader className="pb-4 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Bill Details &amp; Cadence</CardTitle>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              <span>Smart Cadence Forecasting</span>
            </div>
          </div>
          <CardDescription className="text-xs">
            Enter bill parameters to forecast cashflow, eliminate late fees, and unlock card multipliers.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <form action={submit} className="space-y-6">
            <BillFormFields spendCategoryOptions={spendCategoryOptions} />
            <div className="pt-3 border-t border-border/60">
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-sm hover:bg-foreground/90 active:scale-[0.99] transition-all cursor-pointer"
              >
                <PlusCircle className="size-4" />
                <span>Save and Create Bill</span>
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
