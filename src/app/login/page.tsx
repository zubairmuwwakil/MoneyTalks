import { redirect } from "next/navigation";
import { Coins, Mail, Sparkles } from "lucide-react";
import { auth, signIn } from "@/auth";
import { PasskeySignInButton } from "@/components/passkey-buttons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { sent, error } = await searchParams;

  return (
    <main className="flex min-h-[85vh] items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-md">
            <Coins className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MoneyTalks</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Personal finance command center</p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="pb-4 text-center">
            <CardTitle className="text-base font-semibold">Sign in to your account</CardTitle>
            <CardDescription>
              Enter your email to receive a passwordless magic link or use a passkey.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sent ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-xs font-medium text-emerald-800 dark:text-emerald-300 space-y-1">
                <p className="font-semibold">Check your email</p>
                <p className="text-emerald-700 dark:text-emerald-400">
                  A sign-in link is on its way to your inbox.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await signIn("resend", {
                      email: formData.get("email"),
                      redirectTo: "/",
                    });
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1" htmlFor="email">
                      Email address
                    </label>
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground">
                        <Mail className="size-4" />
                      </div>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="you@example.com"
                        className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
                  >
                    Send sign-in link
                  </button>
                </form>

                <div className="relative flex items-center justify-center">
                  <div className="w-full border-t border-border/80" />
                  <span className="bg-card px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    or
                  </span>
                </div>

                <PasskeySignInButton />
              </div>
            )}

            {error ? (
              <p className="text-center text-xs font-medium text-red-600" role="alert">
                Sign-in failed. Try again.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
