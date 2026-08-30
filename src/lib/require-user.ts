import { notFound, redirect } from "next/navigation";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasAllowlist, isAllowedEmail } from "@/lib/allowlist";

type ResolvedUser = { id: string; email: string | null; clerkId: string };

async function resolveUser(): Promise<ResolvedUser | null> {
  const { userId: clerkId, sessionId } = await auth();
  if (!clerkId) return null;

  const existing = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, email: true },
  });
  if (existing) {
    // Re-enforce the allowlist on every resolution, not just at signup, so
    // removing an email actually revokes access for an existing account.
    const allowlist = process.env.ALLOWED_EMAILS;
    if (hasAllowlist(allowlist) && !isAllowedEmail(existing.email, allowlist)) {
      if (sessionId) {
        const client = await clerkClient();
        await client.sessions.revokeSession(sessionId);
      }
      return null;
    }
    return { ...existing, clerkId };
  }

  const client = await clerkClient();
  const clerkUser = await client.users.getUser(clerkId);
  const primaryEmail =
    clerkUser.emailAddresses.find(
      (address) =>
        address.id === clerkUser.primaryEmailAddressId && address.verification?.status === "verified",
    )?.emailAddress ?? null;

  // A verified email is always required; the allowlist is checked only when one is
  // configured. Opening signup removed the allowlist, not the verification.
  const signupAllowlist = process.env.ALLOWED_EMAILS;
  if (!primaryEmail || (hasAllowlist(signupAllowlist) && !isAllowedEmail(primaryEmail, signupAllowlist))) {
    if (sessionId) await client.sessions.revokeSession(sessionId);
    return null;
  }

  const byEmail = await prisma.user.findUnique({
    where: { email: primaryEmail },
    select: { id: true, email: true },
  });
  if (byEmail) {
    const linked = await prisma.user.update({
      where: { id: byEmail.id },
      data: { clerkId },
      select: { id: true, email: true },
    });
    return { ...linked, clerkId };
  }

  const created = await prisma.user.create({
    data: { clerkId, email: primaryEmail },
    select: { id: true, email: true },
  });
  return { ...created, clerkId };
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

/**
 * Gate for `/admin/*`. Both admin pages were reachable by ANY signed-in user until 2026-08-24 —
 * they called `requireUserId()`, which only proves someone is logged in. With signup open by
 * default (see docs/decisions/LOG.md 2026-08-17), that put every waitlist email address in front
 * of anyone who registered.
 *
 * FAILS CLOSED when `ADMIN_EMAILS` is unset. An unset allowlist means "nobody is an admin", never
 * "everybody is": a deploy that forgets the variable must lose the admin pages, not expose them.
 * `notFound()` rather than a 403 so the surface does not confirm it exists to a non-admin.
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const user = await resolveUser();
  if (!user) redirect("/login");

  const allowed = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const email = user.email?.trim().toLowerCase();
  if (allowed.length === 0 || !email || !allowed.includes(email)) {
    notFound();
  }
  return { id: user.id, email };
}

export async function getSessionUserId(): Promise<string | null> {
  const user = await resolveUser();
  return user?.id ?? null;
}

export async function getOptionalUser(): Promise<{ id: string; email: string | null } | null> {
  const user = await resolveUser();
  return user ? { id: user.id, email: user.email } : null;
}

// Account deletion is the one caller that needs both identities at once: the local row to
// cascade and the Clerk user to remove. Resolving them together keeps the route from
// re-entering `auth()` and racing its own deletion.
export async function getSessionAccount(): Promise<{ id: string; clerkId: string } | null> {
  const user = await resolveUser();
  return user ? { id: user.id, clerkId: user.clerkId } : null;
}
import "server-only";
