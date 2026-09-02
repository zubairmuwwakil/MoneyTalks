import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ verify: vi.fn(), findUser: vi.fn(), getUser: vi.fn(), purchases: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ idPOAuthAccessToken: { verify: mock.verify }, users: { getUser: mock.getUser } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mock.findUser },
  purchase: { findMany: mock.purchases },
  recurringObligation: { findMany: async () => [] },
  returnItem: { findMany: async () => [] },
  bill: { findMany: async () => [] },
} }));
import { handleMcp, handleMetadata } from "./http";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://inunity.ca/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer oat_${"a".repeat(32)}`, ...headers },
    body: JSON.stringify(body),
  });
}
const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://inunity.ca");
  vi.stubEnv("INUNITY_MCP_OAUTH_CLIENT_ID", "chatgpt-client");
  vi.stubEnv("INUNITY_MCP_OAUTH_ISSUER", "https://clerk.inunity.ca");
  vi.stubEnv("ALLOWED_EMAILS", "");
  mock.verify.mockResolvedValue({ clientId: "chatgpt-client", subject: "user_owner", scopes: ["inunity.read"], revoked: false, expired: false, expiration: Date.now() + 60_000 });
  mock.findUser.mockResolvedValue({ id: "local-owner", email: "owner@example.test" });
  mock.getUser.mockResolvedValue({ privateMetadata: {} });
  mock.purchases.mockResolvedValue([]);
});

describe("MCP over Streamable HTTP", () => {
  it("negotiates initialization with the real MCP SDK", async () => {
    const response = await handleMcp(request(rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } })));
    expect(response.status).toBe(200);
    expect((await response.json()).result.serverInfo.name).toBe("in-unity");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("advertises only read tools, with OAuth metadata and valid schemas", async () => {
    const response = await handleMcp(request(rpc("tools/list")));
    const { result } = await response.json();
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["search", "fetch", "list_records", "get_spending_summary", "get_attention_summary"]);
    for (const tool of result.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["inunity.read"] }]);
      expect(tool._meta.securitySchemes).toEqual([{ type: "oauth2", scopes: ["inunity.read"] }]);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
  it("returns standard search content with canonical source links", async () => {
    mock.purchases.mockResolvedValue([{ id: "p1", merchant: "Cafe", purchasedAt: new Date("2026-09-01"), possibleDuplicateOfId: null }]);
    const response = await handleMcp(request(rpc("tools/call", { name: "search", arguments: { query: "Cafe" } })));
    const { result } = await response.json();
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual({ results: [{ id: "purchase:p1", title: "Cafe · 2026-09-01", url: "https://inunity.ca/purchases/p1" }] });
  });
  it("never shares account context between simultaneous callers", async () => {
    mock.verify.mockImplementation(async token => ({ clientId: "chatgpt-client", subject: token.includes("bbbb") ? "user_b" : "user_a", scopes: ["inunity.read"], revoked: false, expired: false, expiration: Date.now() + 60_000 }));
    mock.findUser.mockImplementation(async ({ where }) => ({ id: where.clerkId, email: "user@example.test" }));
    mock.purchases.mockImplementation(async ({ where }) => [{ id: where.userId, merchant: where.userId, purchasedAt: new Date("2026-09-01"), possibleDuplicateOfId: null }]);
    const call = rpc("tools/call", { name: "search", arguments: { query: "", userId: "attacker-selected" } });
    const responses = await Promise.all([
      handleMcp(request(call)), handleMcp(request(call, { Authorization: `Bearer oat_${"b".repeat(32)}` })),
    ]);
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(JSON.parse(bodies[0].result.content[0].text).results[0].id).toBe("purchase:user_a");
    expect(JSON.parse(bodies[1].result.content[0].text).results[0].id).toBe("purchase:user_b");
  });
  it("masks database errors inside tool results", async () => {
    mock.purchases.mockRejectedValue(new Error("postgres://user:secret@host SELECT private data"));
    const response = await handleMcp(request(rpc("tools/call", { name: "search", arguments: { query: "" } })));
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/postgres|secret|SELECT/);
  });
  it("rejects an invalid fetch identifier before reaching the database", async () => {
    const response = await handleMcp(request(rpc("tools/call", { name: "fetch", arguments: { id: "../../users" } })));
    expect((await response.json()).result.isError).toBe(true);
  });
  it("allows anonymous tool discovery without touching account data", async () => {
    const response = await handleMcp(request(rpc("tools/list"), { Authorization: "" }));
    expect(response.status).toBe(200);
    expect((await response.json()).result.tools).toHaveLength(5);
    expect(mock.verify).not.toHaveBeenCalled();
    expect(mock.findUser).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated tool execution with OAuth discovery, not a login redirect", async () => {
    const response = await handleMcp(request(rpc("tools/call", { name: "search", arguments: { query: "" } }), { Authorization: "" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("https://inunity.ca/.well-known/oauth-protected-resource/mcp");
    expect(response.headers.get("location")).toBeNull();
    expect(mock.purchases).not.toHaveBeenCalled();
  });
  it("rejects untrusted browser origins before verification", async () => {
    const response = await handleMcp(request(rpc("tools/list"), { Origin: "https://untrusted.example" }));
    expect(response.status).toBe(403);
    expect(mock.verify).not.toHaveBeenCalled();
  });
  it("limits request size even without a Content-Length header", async () => {
    const response = await handleMcp(request({ query: "x".repeat(33000) }));
    expect(response.status).toBe(413);
  });
  it("exposes metadata without touching user data", async () => {
    expect(await handleMetadata().json()).toMatchObject({ resource: "https://inunity.ca/mcp", scopes_supported: ["inunity.read"] });
    expect(mock.verify).not.toHaveBeenCalled();
  });
  it("fails closed when deployment is not configured", async () => {
    vi.stubEnv("INUNITY_MCP_OAUTH_CLIENT_ID", "");
    expect((await handleMcp(request(rpc("tools/list")))).status).toBe(503);
    expect(mock.verify).not.toHaveBeenCalled();
  });
});
