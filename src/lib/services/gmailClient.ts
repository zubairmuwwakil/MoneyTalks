//gmail helpers

import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encryptConnectionSecrets, readConnectionSecret } from "@/lib/security/emailConnectionSecrets";

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
}

/** Every mailbox an owner has connected, oldest first. */
export async function listUserConnections(userId: string) {
  return prisma.emailConnection.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
}

/**
 * Authenticate ONE connection. Takes a connection id, not an owner id — an
 * owner may now have several mailboxes, and "the owner's connection" is no
 * longer a well-defined thing. Both are plain strings, so a call site that
 * passes the wrong one still compiles: check the argument, not the type.
 */
export async function getAuthedGmail(connectionId: string) {
  const conn = await prisma.emailConnection.findUnique({ where: { id: connectionId } });
  if (!conn) return null;

  // Secrets are keyed by OWNER — a person's mailboxes share one derived key.
  // Keying them on the connection id would encrypt under a key nothing can
  // reproduce, quietly making every stored token undecryptable.
  // Decrypted in memory only; never re-assigned onto `conn` or logged.
  const accessToken = readConnectionSecret(conn.userId, "accessToken", conn.accessToken);
  const refreshToken = readConnectionSecret(conn.userId, "refreshToken", conn.refreshToken);

  const hasAccess = Boolean(accessToken);
  const hasRefresh = Boolean(refreshToken);

  // if access token is expired and we have no refresh token -> must reconnect
  if (!hasRefresh && conn.expiry && conn.expiry.getTime() <= Date.now()) {
    return null;
  }

  if (!hasAccess && !hasRefresh) return null;

  const oauth2 = oauthClient();
  oauth2.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken ?? undefined,
    expiry_date: conn.expiry ? conn.expiry.getTime() : undefined,
  });

  // googleapis emits `tokens` mid-request when it silently refreshes. The write
  // must be awaited before the serverless function returns, or the new refresh
  // token is lost and the user is silently disconnected. Promises are chained so
  // concurrent refreshes cannot interleave, and the chain is kept rejection-free.
  let pendingPersist: Promise<void> = Promise.resolve();

  oauth2.on("tokens", (t) => {
    const secrets = encryptConnectionSecrets(conn.userId, {
      ...(t.access_token ? { accessToken: t.access_token } : {}),
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
    });
    const data = {
      ...secrets,
      ...(t.expiry_date ? { expiry: new Date(t.expiry_date) } : {}),
    };
    if (Object.keys(data).length === 0) return;

    pendingPersist = pendingPersist
      .then(() => prisma.emailConnection.update({ where: { id: connectionId }, data }))
      .then(() => undefined)
      .catch((err) => {
        console.error(`[gmail] failed to persist refreshed tokens for connection ${connectionId}`, err);
      });
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  /** Await before returning a response, so refreshed tokens are durably stored. */
  const flushTokens = () => pendingPersist;

  return { gmail, oauth2, conn, flushTokens };
}
