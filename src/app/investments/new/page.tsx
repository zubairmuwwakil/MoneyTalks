import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAccount } from "@/app/investments/actions";
import { requireUserId } from "@/lib/require-user";

const TYPES = ["RRSP", "TFSA", "RDSP", "FHSA", "ROTH_IRA", "NON_REGISTERED", "CASH", "CHEQUING", "CRYPTO"] as const;
const CURRENCIES = ["CAD", "USD", "JMD"] as const;

const inputStyle =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

export default async function NewAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUserId();
  const { error } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const result = await createAccount(formData);
    if (result.ok) redirect("/investments");
    redirect(`/investments/new?error=${encodeURIComponent(result.error)}`);
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
        <h1 className="text-2xl font-bold tracking-tight">Add account</h1>
        <p className="text-sm text-muted-foreground">
          Create a new registered, cash, crypto, or brokerage account.
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
            <Building2 className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Account Information</CardTitle>
          </div>
          <CardDescription>
            Specify the institution and tax registration category.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Account Name
              </label>
              <input
                name="name"
                required
                placeholder="e.g. Wealthsimple TFSA"
                className={inputStyle}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Institution
              </label>
              <input
                name="institution"
                required
                placeholder="e.g. Wealthsimple, RBC, Questrade"
                className={inputStyle}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Account Type
              </label>
              <select name="type" required className={inputStyle}>
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Country (2-letter ISO)
                </label>
                <input
                  name="country"
                  defaultValue="CA"
                  required
                  pattern="[A-Z]{2}"
                  className={inputStyle}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Currency
                </label>
                <select name="currency" required className={inputStyle}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
              <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer">
                <input type="checkbox" name="isUSSitus" value="true" className="rounded" />
                <span>US-situs account (held with a US financial institution)</span>
              </label>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
              >
                Create account
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
