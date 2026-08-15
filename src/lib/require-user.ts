import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function requireUser(): Promise<{ email: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  return { email };
}

export async function requireUserId(): Promise<string> {
  const { email } = await requireUser();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) redirect("/login");
  return user.id;
}

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}
