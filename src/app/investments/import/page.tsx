import { redirect } from "next/navigation";
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
        `/investments/import?done=${result.accounts} accounts, ${result.holdings} holdings, ${result.snapshots} snapshots, ${result.fxRates} FX rates`,
      );
    }
    redirect(`/investments/import?error=${encodeURIComponent(result.error ?? "Import failed")}`);
  }

  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Import data</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Upload a JSON file matching <code>docs/import-format.md</code>. Imports are idempotent —
        re-uploading the same file is safe. Your file never enters the repository; it goes straight
        to your database.
      </p>
      {done ? <p className="mt-4 text-sm text-green-700">Imported: {done}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      <form action={submit} className="mt-6 flex max-w-md items-center gap-3">
        <input type="file" name="file" accept="application/json,.json" required className="text-sm" />
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">
          Import
        </button>
      </form>
    </main>
  );
}
