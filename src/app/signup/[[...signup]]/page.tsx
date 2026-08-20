import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignUp } from "@clerk/nextjs";

export default async function SignUpPage() {
  const { userId } = await auth();
  if (userId) redirect("/");

  return (
    <main className="flex min-h-[85vh] items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground/10 text-foreground shadow-md overflow-hidden p-2">
            <Image src="/icon.svg" alt="In Unity" width={40} height={40} className="size-10" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">In Unity</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Personal finance command center</p>
          </div>
        </div>

        <div className="flex justify-center">
          <SignUp signInUrl="/login" />
        </div>
      </div>
    </main>
  );
}
