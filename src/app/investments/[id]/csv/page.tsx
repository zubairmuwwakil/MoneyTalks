import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { importCsv } from "./actions";
import { CsvImportForm } from "./csv-import-form";

export default async function CsvImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { done, error } = await searchParams;
  const account = await prisma.financialAccount.findFirst({ where: { id, userId } });
  if (!account) notFound();

  async function submit(formData: FormData) {
    "use server";
    const result = await importCsv(formData);
    if (result.ok) {
      redirect(
        `/investments/${formData.get("accountId")}/csv?done=${encodeURIComponent(
          `${result.imported} imported, ${result.skippedDuplicates} duplicates skipped, ${result.errors} error rows`,
        )}`,
      );
    }
    redirect(`/investments/${formData.get("accountId")}/csv?error=${encodeURIComponent(result.error ?? "failed")}`);
  }

  return (
    <main className="max-w-2xl space-y-6 py-6 sm:py-8">
      <div>
        <Link
          href={`/investments/${account.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>← back to account</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">CSV import — {account.name}</h1>
        <p className="text-sm text-muted-foreground">
          Import transactions directly from your institution&apos;s statement CSV.
        </p>
      </div>

      {done ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Statement processed</p>
            <p className="mt-0.5 text-emerald-700 dark:text-emerald-400">{done}</p>
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
            <FileSpreadsheet className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Statement CSV &amp; Column Mapping</CardTitle>
          </div>
          <CardDescription>
            The file is parsed in memory and never stored; only validated rows become transactions.
            Re-importing is safe — duplicates are skipped by content hash.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CsvImportForm accountId={account.id} currency={account.currency as Currency} importAction={submit} />
        </CardContent>
      </Card>
    </main>
  );
}
