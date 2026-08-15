import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Passkey from "next-auth/providers/passkey";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/prisma";
import { isAllowedEmail } from "@/lib/allowlist";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  experimental: { enableWebAuthn: true },
  session: { strategy: "database" },
  trustHost: true,
  providers: [Passkey, Resend({ from: process.env.AUTH_EMAIL_FROM })],
  pages: { signIn: "/login", verifyRequest: "/login?sent=1" },
  callbacks: {
    signIn({ user }) {
      return isAllowedEmail(user.email, process.env.ALLOWED_EMAILS);
    },
  },
});
