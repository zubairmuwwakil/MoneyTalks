import "server-only";

export const MCP_SCOPE = "inunity.read";
export const MCP_PATH = "/mcp";
export const MCP_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

export function mcpConfig() {
  const clientId = process.env.INUNITY_MCP_OAUTH_CLIENT_ID?.trim();
  const issuer = process.env.INUNITY_MCP_OAUTH_ISSUER?.trim();
  const appUrl = process.env.APP_URL?.trim();
  if (!clientId || !issuer || !appUrl) return null;
  try {
    const app = new URL(appUrl);
    const auth = new URL(issuer);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(app.hostname);
    if ((!local && app.protocol !== "https:") || auth.protocol !== "https:") return null;
    if (app.username || app.password || auth.username || auth.password) return null;
    if (auth.pathname !== "/" || auth.search || auth.hash) return null;
    return { clientId, issuer: auth.origin, origin: app.origin, resource: `${app.origin}${MCP_PATH}` };
  } catch {
    return null;
  }
}

export function authChallenge(error = "invalid_token") {
  const config = mcpConfig();
  return `Bearer resource_metadata="${config?.origin ?? "https://inunity.ca"}${MCP_METADATA_PATH}", scope="${MCP_SCOPE}", error="${error}", error_description="Connect your In Unity account with read access."`;
}

export function resourceMetadata() {
  const config = mcpConfig();
  if (!config) return null;
  return {
    resource: config.resource,
    resource_name: "In Unity",
    authorization_servers: [config.issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_policy_uri: `${config.origin}/privacy`,
  };
}
