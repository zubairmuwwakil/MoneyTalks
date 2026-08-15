import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
    <main className="max-w-xl space-y-4 py-8">
      <h1 className="text-xl font-semibold">CSV import — {account.name}</h1>
      <p className="text-sm text-muted-foreground">
        The file is parsed in memory and never stored; only validated rows become transactions.
        Re-importing an overlapping file is safe — duplicates are skipped by content hash. Use
        Preview to check your column mapping before importing — it parses the file the same way
        Import does, but writes nothing.
      </p>
      {done ? <p className="text-sm text-green-700">{done}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <CsvImportForm accountId={account.id} currency={account.currency as Currency} importAction={submit} />
      <Link href={`/investments/${account.id}`} className="text-sm underline">← back to account</Link>
    </main>
  );
}
