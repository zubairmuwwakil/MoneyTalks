import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { PasskeySignInButton } from "@/components/passkey-buttons";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { sent, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">MoneyTalks</h1>
        {sent ? (
          <p className="text-sm">
            Check your email — a sign-in link is on its way.
          </p>
        ) : (
          <div className="space-y-3">
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
              <label className="block text-sm" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded border px-3 py-2"
              />
              <button
                type="submit"
                className="w-full rounded bg-foreground px-3 py-2 text-background"
              >
                Send sign-in link
              </button>
            </form>
            <PasskeySignInButton />
          </div>
        )}
        {error ? (
          <p className="text-sm text-red-600">Sign-in failed. Try again.</p>
        ) : null}
      </div>
    </main>
  );
}
