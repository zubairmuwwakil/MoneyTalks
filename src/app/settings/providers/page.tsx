import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { listProviderKeyStatus, SUPPORTED_PROVIDERS } from "@/lib/security/providerKeys";
import { removeProviderCredential, saveProviderCredential } from "./actions";

const input =
  "mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";
const label = "block text-xs font-medium text-foreground";

function statusPath(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return `/settings/providers?${query}`;
}

export default async function ProviderKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const userId = await requireUserId();
  const { error, saved } = await searchParams;
  const stored = await listProviderKeyStatus(prisma, userId);
  const byProvider = new Map(stored.map((row) => [row.provider, row]));

  async function submitKey(formData: FormData) {
    "use server";
    const result = await saveProviderCredential(formData);
    redirect(result.ok ? statusPath({ saved: result.message }) : statusPath({ error: result.error }));
  }

  async function submitRemove(formData: FormData) {
    "use server";
    const result = await removeProviderCredential(formData);
    redirect(result.ok ? statusPath({ saved: result.message }) : statusPath({ error: result.error }));
  }

  return (
    <main className="max-w-3xl space-y-6 py-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Bring your own market-data credential. When you supply one, your holdings are priced under your
          own licence and quota. Prices are <span className="font-medium text-foreground">daily closes, not real-time</span>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/settings" className="rounded-full border px-3 py-1 hover:bg-muted">Profile</Link>
          <Link href="/settings/notifications" className="rounded-full border px-3 py-1 hover:bg-muted">Notifications &amp; email</Link>
          <Link href="/settings/wallet" className="rounded-full border px-3 py-1 hover:bg-muted">Apple Wallet</Link>
          <Link href="/settings/merchants" className="rounded-full border px-3 py-1 hover:bg-muted">Merchants</Link>
          <span className="rounded-full bg-foreground px-3 py-1 text-background">Market data keys</span>
          <Link href="/settings/automation" className="rounded-full border px-3 py-1 hover:bg-muted">Email automation</Link>
          <Link href="/settings/privacy" className="rounded-full border px-3 py-1 hover:bg-muted">Privacy</Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" aria-hidden="true" />
            How your key is handled
          </CardTitle>
          <CardDescription>Worth reading before you paste a credential anywhere.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The key is encrypted before it is stored, with the ciphertext bound to your account so a value
            copied out of the database cannot be replayed under anyone else&apos;s.
          </p>
          <p>
            It is decrypted only to be attached to a single outbound request to the market-data service,
            which uses it and discards it — that service never stores it.
          </p>
          <p>
            It is never written to a log, shown back to you, or included in a link. To change it, paste a new
            one; there is no way to read the stored value back.
          </p>
          <p>
            If your key fails or hits its quota, pricing falls back to the shared source and each holding
            records which source actually supplied it — you will not be told your key worked when it
            didn&apos;t.
          </p>
        </CardContent>
      </Card>

      {saved ? (
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400" role="status">
          ✓ {saved}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {SUPPORTED_PROVIDERS.map((provider) => {
        const existing = byProvider.get(provider);
        return (
          <Card key={provider}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" aria-hidden="true" />
                {provider}
                {existing ? (
                  <Badge variant="secondary" className="text-xs">
                    key stored
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    not set
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {existing ? (
                  <>
                    Added {existing.createdAt.toISOString().slice(0, 10)}
                    {existing.lastUsedAt
                      ? ` · last refresh ${existing.lastUsedAt.toISOString().slice(0, 10)}`
                      : " · not used yet"}
                    {existing.lastStatus === "NOT_USED" ? (
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        {" "}
                        · stored but not used on the last refresh — prices came from the shared source
                      </span>
                    ) : null}
                  </>
                ) : (
                  "Prices currently come from the shared source."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form action={submitKey} className="space-y-3">
                <input type="hidden" name="provider" value={provider} />
                <div>
                  <label className={label} htmlFor={`key-${provider}`}>
                    {provider === "QUESTRADE" ? "API key / Refresh token" : "API key"}
                  </label>
                  <input
                    id={`key-${provider}`}
                    name="apiKey"
                    type="password"
                    autoComplete="off"
                    required
                    placeholder={
                      existing
                        ? "Paste a new key to replace the stored one"
                        : provider === "QUESTRADE"
                        ? "Paste your Questrade portal token"
                        : "Paste your key"
                    }
                    className={input}
                  />
                  {provider === "QUESTRADE" ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Questrade portal tokens are automatically exchanged for active OAuth credentials upon saving.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className={label} htmlFor={`label-${provider}`}>
                    Label (optional)
                  </label>
                  <input id={`label-${provider}`} name="label" type="text" className={input} />
                </div>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs transition-colors hover:bg-foreground/90 cursor-pointer"
                >
                  {existing ? "Replace key" : "Store key"}
                </button>
              </form>

              {existing ? (
                <form action={submitRemove}>
                  <input type="hidden" name="provider" value={provider} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Remove stored key
                  </button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </main>
  );
}
