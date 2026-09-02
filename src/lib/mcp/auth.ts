import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasAllowlist, isAllowedEmail } from "@/lib/allowlist";
import { MCP_SCOPE, mcpConfig } from "./config";

export class McpAccessError extends Error {
  constructor(public readonly status: 401 | 403 | 503, public readonly code: string) {
    super(code);
  }
}

/** Resolve only an existing account. Never provision or link accounts from a tool request. */
export async function authenticateMcp(request: Request): Promise<string> {
  const config = mcpConfig();
  if (!config) throw new McpAccessError(503, "integration_not_configured");
  const authorization = request.headers.get("authorization") ?? "";
  // Opaque Clerk OAuth tokens are introspected on every request so revocation
  // takes effect immediately. Browser sessions, API keys and JWTs aren't accepted.
  const match = /^Bearer (oat_[A-Za-z0-9_-]{16,512})$/i.exec(authorization);
  if (!match) throw new McpAccessError(401, "invalid_token");
  const client = await clerkClient();
  let token;
  try {
    token = await client.idPOAuthAccessToken.verify(match[1]);
  } catch (error) {
    const status = (error as { status?: number }).status;
    throw new McpAccessError(status === 400 || status === 401 || status === 404 ? 401 : 503,
      status === 400 || status === 401 || status === 404 ? "invalid_token" : "authorization_unavailable");
  }
  // This pre-registered OAuth client is dedicated exclusively to this resource.
  // Reject tokens from every other application in the same Clerk instance.
  if (token.clientId !== config.clientId || token.revoked || token.expired ||
      !token.expiration || token.expiration <= Date.now() || !token.subject?.startsWith("user_")) {
    throw new McpAccessError(401, "invalid_token");
  }
  if (!token.scopes.includes(MCP_SCOPE)) throw new McpAccessError(403, "insufficient_scope");
  const user = await prisma.user.findUnique({ where: { clerkId: token.subject }, select: { id: true, email: true } });
  if (!user || (hasAllowlist(process.env.ALLOWED_EMAILS) && !isAllowedEmail(user.email, process.env.ALLOWED_EMAILS))) {
    throw new McpAccessError(403, "account_unavailable");
  }
  const identity = await client.users.getUser(token.subject);
  if (identity.privateMetadata.inunityMcpPaused === true) throw new McpAccessError(403, "access_paused");
  return user.id;
}
