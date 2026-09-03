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
  const match = /^Bearer ([A-Za-z0-9._~-]{16,8192})$/i.exec(authorization);
  if (!match) throw new McpAccessError(401, "invalid_token");
  const client = await clerkClient();
  let state;
  try {
    // Clerk verifies both its JWT and opaque OAuth access-token formats here,
    // while rejects session, API-key, and machine-to-machine credentials.
    state = await client.authenticateRequest(request, { acceptsToken: "oauth_token" });
  } catch (error) {
    const status = (error as { status?: number }).status;
    throw new McpAccessError(status === 400 || status === 401 || status === 404 ? 401 : 503,
      status === 400 || status === 401 || status === 404 ? "invalid_token" : "authorization_unavailable");
  }
  if (!state.isAuthenticated || state.tokenType !== "oauth_token") {
    throw new McpAccessError(401, "invalid_token");
  }
  const token = state.toAuth();
  // This pre-registered OAuth client is dedicated exclusively to this resource.
  // Reject tokens from every other application in the same Clerk instance.
  if (token.clientId !== config.clientId || !token.userId?.startsWith("user_")) {
    throw new McpAccessError(401, "invalid_token");
  }
  if (!token.scopes.includes(MCP_SCOPE)) throw new McpAccessError(403, "insufficient_scope");
  const user = await prisma.user.findUnique({ where: { clerkId: token.userId }, select: { id: true, email: true } });
  if (!user || (hasAllowlist(process.env.ALLOWED_EMAILS) && !isAllowedEmail(user.email, process.env.ALLOWED_EMAILS))) {
    throw new McpAccessError(403, "account_unavailable");
  }
  const identity = await client.users.getUser(token.userId);
  if (identity.privateMetadata.inunityMcpPaused === true) throw new McpAccessError(403, "access_paused");
  return user.id;
}
