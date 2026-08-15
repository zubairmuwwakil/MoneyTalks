import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { importCsv } from "./actions";

const TYPES = ["CONTRIBUTION", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE"];
const input = "mt-1 w-full rounded border px-2 py-1 text-sm";

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
        Re-importing an overlapping file is safe — duplicates are skipped by content hash.
      </p>
      {done ? <p className="text-sm text-green-700">{done}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <form action={submit} className="space-y-3">
        <input type="hidden" name="accountId" value={account.id} />
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label>Date column #<input name="dateCol" defaultValue={0} className={input} /></label>
          <label>Description column #<input name="descriptionCol" defaultValue={1} className={input} /></label>
          <label>Amount column #<input name="amountCol" defaultValue={2} className={input} /></label>
          <label>Date format
            <select name="dateFormat" className={input}>
              <option value="YMD">YYYY-MM-DD</option>
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
            </select>
          </label>
          <label>Positive amounts are
            <select name="positiveType" className={input}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Negative amounts are
            <select name="negativeType" defaultValue="WITHDRAWAL" className={input}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="hasHeader" value="true" defaultChecked /> First row is a header
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="negate" value="true" /> Flip signs (statement shows spending as positive)
        </label>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">Import</button>
      </form>
      <Link href={`/investments/${account.id}`} className="text-sm underline">← back to account</Link>
    </main>
  );
}
