import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcp, McpAccessError } from "./auth";
import { authChallenge, MCP_SCOPE, mcpConfig, resourceMetadata } from "./config";
import { createInUnityMcpServer } from "./server";

const oauthSecuritySchemes = [{ type: "oauth2", scopes: [MCP_SCOPE] }];

function headers(request: Request) {
  const result = new Headers({ "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" });
  const origin = request.headers.get("origin");
  const allowed = [mcpConfig()?.origin, "https://chatgpt.com", "https://chat.openai.com"];
  if (process.env.NODE_ENV !== "production") allowed.push("http://localhost:6274");
  if (origin && !allowed.includes(origin)) return null;
  if (origin) {
    result.set("Access-Control-Allow-Origin", origin);
    result.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    result.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id");
    result.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
  }
  return result;
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new McpAccessError(401, "invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 32768) { await reader.cancel(); throw new RangeError("request_too_large"); }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function withChatGptToolAuth(body: ArrayBuffer, parsedRequest: unknown) {
  if (!body.byteLength || !parsedRequest || typeof parsedRequest !== "object" || (parsedRequest as { method?: unknown }).method !== "tools/list") return body;
  try {
    const response = JSON.parse(Buffer.from(body).toString("utf8")) as { result?: { tools?: Array<Record<string, unknown>> } };
    if (!Array.isArray(response.result?.tools)) return body;
    for (const tool of response.result.tools) tool.securitySchemes = oauthSecuritySchemes;
    return Buffer.from(JSON.stringify(response));
  } catch {
    return body;
  }
}

export async function handleMcp(request: Request) {
  const responseHeaders = headers(request);
  if (!responseHeaders) return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!mcpConfig()) return Response.json({ error: "integration_not_configured" }, { status: 503, headers: responseHeaders });
  try {
    const userId = await authenticateMcp(request);
    if (request.method !== "POST") {
      responseHeaders.set("Allow", "POST, OPTIONS");
      return new Response(null, { status: 405, headers: responseHeaders });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "expected_json" }, { status: 415, headers: responseHeaders });
    }
    const parsedBody = await readBody(request);
    // One server and transport per request: no user state persists between callers.
    const server = createInUnityMcpServer(userId, mcpConfig()!.origin);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody });
      // Consume the JSON body before closing the transport.
      const body = withChatGptToolAuth(await response.arrayBuffer(), parsedBody);
      for (const [key, value] of responseHeaders) response.headers.set(key, value);
      return new Response(body.byteLength ? body : null, { status: response.status, headers: response.headers });
    } finally {
      await server.close();
    }
  } catch (error) {
    if (error instanceof McpAccessError) {
      if (error.status !== 503) responseHeaders.set("WWW-Authenticate", authChallenge(error.code));
      return Response.json({ error: error.code }, { status: error.status, headers: responseHeaders });
    }
    if (error instanceof RangeError) return Response.json({ error: "request_too_large" }, { status: 413, headers: responseHeaders });
    if (error instanceof SyntaxError) return Response.json({ error: "invalid_json" }, { status: 400, headers: responseHeaders });
    // Do not return SDK errors, request bodies, tokens, or database diagnostics.
    return Response.json({ error: "service_unavailable" }, { status: 503, headers: responseHeaders });
  }
}

export function handleMetadata() {
  const metadata = resourceMetadata();
  return Response.json(metadata ?? { error: "integration_not_configured" }, {
    status: metadata ? 200 : 503,
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

export function metadataOptions() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
