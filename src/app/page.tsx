import { signOut } from "@/auth";
import { PasskeyRegisterButton } from "@/components/passkey-buttons";
import { requireUser } from "@/lib/require-user";

export default async function Home() {
  const user = await requireUser();

  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user.email}. Net worth, alerts, and upcoming payments
        arrive in Phase 1-2.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <PasskeyRegisterButton />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="rounded border px-3 py-1 text-sm">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
