import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { readConnectionSecret } from "@/lib/security/emailConnectionSecrets";

type ImapAuth =
  | { user: string; accessToken: string }
  | { user: string; pass: string };

export async function getAuthedImap(userId: string) {
  const conn = await prisma.emailConnection.findUnique({ where: { userId } });
  if (!conn) return null;

  const host = conn.imapHost ?? process.env.IMAP_HOST ?? "imap.gmail.com";
  const port = Number(conn.imapPort ?? process.env.IMAP_PORT ?? 993);
  const secureRaw = conn.imapSecure ?? (process.env.IMAP_SECURE ? process.env.IMAP_SECURE === "true" : undefined);
  const secure = secureRaw === undefined ? true : Boolean(secureRaw);

  const user = conn.imapUser ?? conn.emailAddress ?? process.env.IMAP_USER;

  // Decrypted in memory only, at the point of use.
  const accessToken = readConnectionSecret(userId, "accessToken", conn.accessToken);
  const password = readConnectionSecret(userId, "imapPassword", conn.imapPassword) ?? process.env.IMAP_PASSWORD;

  // XOAUTH2 with a stale access token fails the IMAP handshake outright, so an
  // expired token must not shadow a perfectly good stored password.
  const accessTokenUsable =
    accessToken && (!conn.expiry || conn.expiry.getTime() > Date.now()) ? accessToken : null;

  let auth: ImapAuth | null = null;
  if (accessTokenUsable && user) {
    auth = { user, accessToken: accessTokenUsable };
  } else if (user && password) {
    auth = { user, pass: password };
  }

  if (!auth) return null;

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth,
    logger: false,
  });

  await client.connect();
  return { client, conn };
}
