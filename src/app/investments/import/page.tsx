import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileCode2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserId } from "@/lib/require-user";
import { importJson } from "./actions";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  await requireUserId();
  const { done, error } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const result = await importJson(formData);
    if (result.ok) {
      redirect(
        `/investments/import?done=${result.accounts} accounts, ${result.holdings} holdings, ${result.snapshots} snapshots, ${result.fxRates} FX rates, ${result.bills} bills, ${result.cards} cards`,
      );
    }
    redirect(`/investments/import?error=${encodeURIComponent(result.error ?? "Import failed")}`);
  }

  return (
    <main className="max-w-xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href="/investments"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Investments</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Import data</h1>
        <p className="text-sm text-muted-foreground">
          Bulk import your financial accounts, holdings, snapshots, bills, and cards.
        </p>
      </div>

      {done ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Import completed successfully</p>
            <p className="mt-0.5 text-emerald-700 dark:text-emerald-400">Imported: {done}</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-600" role="alert">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">JSON Import File</CardTitle>
          </div>
          <CardDescription>
            Upload a JSON file matching <code className="rounded bg-muted px-1 py-0.5 text-xs">docs/import-format.md</code>.
            Imports are idempotent — re-uploading the same file is completely safe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-4">
            <div className="rounded-xl border-2 border-dashed border-border/80 bg-muted/20 p-6 text-center transition-colors hover:bg-muted/30">
              <input
                type="file"
                name="file"
                accept="application/json,.json"
                required
                className="w-full text-xs text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-background hover:file:bg-foreground/90 cursor-pointer"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Your data goes straight to your private database and never leaves your control.
              </p>
            </div>

            <button
              type="submit"
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
            >
              <Upload className="size-3.5" />
              <span>Import</span>
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
