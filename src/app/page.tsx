import { signOut } from "@/auth";
import { PasskeyRegisterButton } from "@/components/passkey-buttons";
import { requireUser } from "@/lib/require-user";

export default async function Home() {
  const user = await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">MoneyTalks</h1>
      <p className="text-sm">Signed in as {user.email}</p>
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
    </main>
  );
}
