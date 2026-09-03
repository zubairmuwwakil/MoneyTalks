import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ authenticateRequest: vi.fn(), findUser: vi.fn(), getUser: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ authenticateRequest: mock.authenticateRequest, users: { getUser: mock.getUser } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mock.findUser } } }));
import { authenticateMcp } from "./auth";
import { mcpConfig, resourceMetadata } from "./config";

const request = (token = `oat_${"a".repeat(32)}`) => new Request("https://inunity.ca/mcp", { headers: { Authorization: `Bearer ${token}` } });
const validOAuth = (properties: Record<string, unknown> = {}) => ({
  isAuthenticated: true,
  tokenType: "oauth_token",
  toAuth: () => ({ clientId: "chatgpt-client", userId: "user_owner", scopes: ["inunity.read"], ...properties }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://inunity.ca");
  vi.stubEnv("INUNITY_MCP_OAUTH_CLIENT_ID", "chatgpt-client");
  vi.stubEnv("INUNITY_MCP_OAUTH_ISSUER", "https://clerk.inunity.ca");
  vi.stubEnv("ALLOWED_EMAILS", "");
  mock.authenticateRequest.mockResolvedValue(validOAuth());
  mock.findUser.mockResolvedValue({ id: "local-owner", email: "owner@example.test" });
  mock.getUser.mockResolvedValue({ privateMetadata: {} });
});

describe("MCP account authorization", () => {
  it.each([
    `oat_${"a".repeat(32)}`,
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyX293bmVyIn0.c2lnbmF0dXJlX2J5dGVz",
  ])("resolves the local owner from a verified dedicated OAuth token", async token => {
    await expect(authenticateMcp(request(token))).resolves.toBe("local-owner");
    expect(mock.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), { acceptsToken: "oauth_token" });
    expect(mock.findUser).toHaveBeenCalledWith({ where: { clerkId: "user_owner" }, select: { id: true, email: true } });
  });
  it.each(["", "eyJ.session.jwt", "m2m_secret", "api_key", "oat_short"])("rejects unsupported token %s without contacting Clerk", async token => {
    await expect(authenticateMcp(request(token))).rejects.toMatchObject({ status: 401 });
    expect(mock.authenticateRequest).not.toHaveBeenCalled();
    expect(mock.findUser).not.toHaveBeenCalled();
  });
  it.each([{ clientId: "another-app" }, { userId: "org_workspace" }])("rejects invalid token properties %j", async properties => {
    mock.authenticateRequest.mockResolvedValue(validOAuth(properties));
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 401 });
    expect(mock.findUser).not.toHaveBeenCalled();
  });
  it("rejects credentials Clerk does not authenticate as OAuth", async () => {
    mock.authenticateRequest.mockResolvedValue({ isAuthenticated: false, tokenType: null });
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });
  it("requires financial read permission even for a valid OAuth identity", async () => {
    mock.authenticateRequest.mockResolvedValue(validOAuth({ scopes: ["profile", "email"] }));
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 403, code: "insufficient_scope" });
  });
  it("never provisions an account through MCP", async () => {
    mock.findUser.mockResolvedValue(null);
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks the signup kill switch for previously authorized users", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "someone-else@example.test");
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 403 });
  });
  it("honors the user's pause on each request", async () => {
    await expect(authenticateMcp(request())).resolves.toBe("local-owner");
    mock.getUser.mockResolvedValue({ privateMetadata: { inunityMcpPaused: true } });
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 403, code: "access_paused" });
    expect(mock.authenticateRequest).toHaveBeenCalledTimes(2);
  });
  it("fails closed and masks provider errors", async () => {
    mock.authenticateRequest.mockRejectedValue({ status: 500, message: "provider secret" });
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 503, message: "authorization_unavailable" });
  });
  it("is disabled until a dedicated OAuth client is configured", async () => {
    vi.stubEnv("INUNITY_MCP_OAUTH_CLIENT_ID", "");
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 503 });
    expect(mock.authenticateRequest).not.toHaveBeenCalled();
  });
});

describe("OAuth discovery", () => {
  it("advertises a fixed canonical resource and read scope", () => {
    expect(resourceMetadata()).toMatchObject({ resource: "https://inunity.ca/mcp", authorization_servers: ["https://clerk.inunity.ca"], scopes_supported: ["inunity.read"] });
  });
  it.each(["http://clerk.inunity.ca", "https://clerk.inunity.ca/path", "https://user:password@clerk.inunity.ca"])("rejects invalid issuers %s", issuer => {
    vi.stubEnv("INUNITY_MCP_OAUTH_ISSUER", issuer);
    expect(mcpConfig()).toBeNull();
  });
});
