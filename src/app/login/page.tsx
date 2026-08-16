import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignIn } from "@clerk/nextjs";
import { Coins } from "lucide-react";

export default async function LoginPage() {
  const { userId } = await auth();
  if (userId) redirect("/");

  return (
    <main className="flex min-h-[85vh] items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-md">
            <Coins className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MoneyTalks</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Personal finance command center</p>
          </div>
        </div>

        <div className="flex justify-center">
          <SignIn routing="hash" fallbackRedirectUrl="/" signUpUrl="/login" signInUrl="/login" />
        </div>
      </div>
    </main>
  );
}
