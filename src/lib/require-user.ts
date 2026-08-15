import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireUser(): Promise<{ email: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  return { email };
}
