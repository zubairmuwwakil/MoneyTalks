import { redirect } from "next/navigation";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isAllowedEmail } from "@/lib/allowlist";

type ResolvedUser = { id: string; email: string | null };

async function resolveUser(): Promise<ResolvedUser | null> {
  const { userId: clerkId, sessionId } = await auth();
  if (!clerkId) return null;

  const existing = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, email: true },
  });
  if (existing) return existing;

  const client = await clerkClient();
  const clerkUser = await client.users.getUser(clerkId);
  const primaryEmail =
    clerkUser.emailAddresses.find(
      (address) =>
        address.id === clerkUser.primaryEmailAddressId && address.verification?.status === "verified",
    )?.emailAddress ?? null;

  if (!primaryEmail || !isAllowedEmail(primaryEmail, process.env.ALLOWED_EMAILS)) {
    if (sessionId) await client.sessions.revokeSession(sessionId);
    return null;
  }

  const byEmail = await prisma.user.findUnique({
    where: { email: primaryEmail },
    select: { id: true, email: true },
  });
  if (byEmail) {
    return prisma.user.update({
      where: { id: byEmail.id },
      data: { clerkId },
      select: { id: true, email: true },
    });
  }

  return prisma.user.create({
    data: { clerkId, email: primaryEmail },
    select: { id: true, email: true },
  });
}

export async function requireUser(): Promise<{ email: string | null }> {
  const user = await resolveUser();
  if (!user) redirect("/login");
  return { email: user.email };
}

export async function requireUserId(): Promise<string> {
  const user = await resolveUser();
  if (!user) redirect("/login");
  return user.id;
}

export async function getSessionUserId(): Promise<string | null> {
  const user = await resolveUser();
  return user?.id ?? null;
}
