import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createBill } from "@/app/bills/actions";
import { requireUserId } from "@/lib/require-user";
import { BillFormFields } from "./form-fields";

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
    <main className="max-w-xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/bills"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Bills</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Add bill</h1>
        <p className="text-sm text-muted-foreground">
          Configure recurring cadence, schedule stepped amounts, and enable autopay.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-600" role="alert">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Receipt className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Bill Details &amp; Cadence</CardTitle>
          </div>
          <CardDescription>
            Enter bill parameters to forecast cashflow and prevent pileups.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-4">
            <BillFormFields />
            <div className="pt-2">
              <button
                type="submit"
                className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
              >
                Create bill
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
