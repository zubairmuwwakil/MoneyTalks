import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ verify: vi.fn(), findUser: vi.fn(), getUser: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ idPOAuthAccessToken: { verify: mock.verify }, users: { getUser: mock.getUser } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mock.findUser } } }));
import { authenticateMcp } from "./auth";
import { mcpConfig, resourceMetadata } from "./config";

const request = (token = `oat_${"a".repeat(32)}`) => new Request("https://inunity.ca/mcp", { headers: { Authorization: `Bearer ${token}` } });
const validToken = () => ({ clientId: "chatgpt-client", subject: "user_owner", scopes: ["inunity.read"], revoked: false, expired: false, expiration: Date.now() + 60_000 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://inunity.ca");
  vi.stubEnv("INUNITY_MCP_OAUTH_CLIENT_ID", "chatgpt-client");
  vi.stubEnv("INUNITY_MCP_OAUTH_ISSUER", "https://clerk.inunity.ca");
  vi.stubEnv("ALLOWED_EMAILS", "");
  mock.verify.mockResolvedValue(validToken());
  mock.findUser.mockResolvedValue({ id: "local-owner", email: "owner@example.test" });
  mock.getUser.mockResolvedValue({ privateMetadata: {} });
});

describe("MCP account authorization", () => {
  it("resolves the local owner from a verified dedicated OAuth token", async () => {
    await expect(authenticateMcp(request())).resolves.toBe("local-owner");
    expect(mock.findUser).toHaveBeenCalledWith({ where: { clerkId: "user_owner" }, select: { id: true, email: true } });
  });
  it.each(["", "eyJ.session.jwt", "m2m_secret", "api_key", "oat_short"])("rejects unsupported token %s without contacting Clerk", async token => {
    await expect(authenticateMcp(request(token))).rejects.toMatchObject({ status: 401 });
    expect(mock.verify).not.toHaveBeenCalled();
    expect(mock.findUser).not.toHaveBeenCalled();
  });
  it.each([
    { clientId: "another-app" }, { revoked: true }, { expired: true },
    { expiration: 1 }, { expiration: null }, { subject: "org_workspace" },
  ])("rejects invalid token properties %j", async properties => {
    mock.verify.mockResolvedValue({ ...validToken(), ...properties });
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 401 });
    expect(mock.findUser).not.toHaveBeenCalled();
  });
  it("requires financial read permission even for a valid OAuth identity", async () => {
    mock.verify.mockResolvedValue({ ...validToken(), scopes: ["profile", "email"] });
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
    expect(mock.verify).toHaveBeenCalledTimes(2);
  });
  it("fails closed and masks provider errors", async () => {
    mock.verify.mockRejectedValue({ status: 500, message: "provider secret" });
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 503, message: "authorization_unavailable" });
  });
  it("is disabled until a dedicated OAuth client is configured", async () => {
    vi.stubEnv("INUNITY_MCP_OAUTH_CLIENT_ID", "");
    await expect(authenticateMcp(request())).rejects.toMatchObject({ status: 503 });
    expect(mock.verify).not.toHaveBeenCalled();
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
