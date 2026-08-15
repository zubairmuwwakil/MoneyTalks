import { redirect } from "next/navigation";
import { createAccount } from "@/app/investments/actions";
import { requireUserId } from "@/lib/require-user";

const TYPES = ["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"] as const;
const CURRENCIES = ["CAD", "USD", "JMD"] as const;

export default async function NewAccountPage() {
  await requireUserId();

  async function submit(formData: FormData) {
    "use server";
    const result = await createAccount(formData);
    if (result.ok) redirect("/investments");
    redirect(`/investments/new?error=${encodeURIComponent(result.error)}`);
  }

  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Add account</h1>
      <form action={submit} className="mt-6 max-w-md space-y-4">
        <label className="block text-sm">
          Name
          <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block text-sm">
          Institution
          <input name="institution" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block text-sm">
          Type
          <select name="type" required className="mt-1 w-full rounded border px-3 py-2">
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            Country (2-letter)
            <input name="country" defaultValue="CA" required pattern="[A-Z]{2}" className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="block text-sm">
            Currency
            <select name="currency" required className="mt-1 w-full rounded border px-3 py-2">
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isUSSitus" value="true" /> US-situs account
        </label>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">
          Create account
        </button>
      </form>
    </main>
  );
}
