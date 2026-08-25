import { describe, it, expect, vi } from "vitest";
import { openCatalogueRequestPr } from "./catalogueRequestPr";

const input = { issuer: "Scotiabank", cardName: "Scotia Platinum Amex", requestCount: 4 };

function fakeGitHub(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.replace("https://api.github.com", "")}`;
    for (const [pattern, value] of Object.entries(overrides)) {
      if (key.startsWith(pattern)) return value as Response;
    }
    if (key.startsWith("GET /repos/o/r/git/ref/heads/main")) return json({ object: { sha: "base-sha" } });
    if (key.startsWith("POST /repos/o/r/git/refs")) return json({});
    if (key.startsWith("PUT /repos/o/r/contents/")) return json({});
    if (key.startsWith("GET /repos/o/r/pulls?")) return json([]);
    if (key.startsWith("POST /repos/o/r/pulls")) return json({ html_url: "https://github.com/o/r/pull/7" });
    throw new Error("unexpected " + key);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
const json = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

describe("openCatalogueRequestPr", () => {
  // A missing token must be a stated configuration fact, not a silent no-op that leaves an
  // operator believing a PR was opened.
  it("fails closed and says why when no token is configured", async () => {
    const result = await openCatalogueRequestPr(input, { token: undefined, repo: "o/r" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("CATALOGUE_GITHUB_TOKEN") });
  });

  it("opens a PR and returns its url", async () => {
    const gh = fakeGitHub();
    const result = await openCatalogueRequestPr(input, { token: "t", repo: "o/r", fetchImpl: gh.impl });
    expect(result).toEqual({ ok: true, url: "https://github.com/o/r/pull/7" });
  });

  // The PR must carry the sourcing checklist and NOT invent card data — that is the whole reason
  // this opens a brief rather than a catalogue entry.
  it("writes a sourcing brief, never rates", async () => {
    const gh = fakeGitHub();
    await openCatalogueRequestPr(input, { token: "t", repo: "o/r", fetchImpl: gh.impl });
    const put = gh.calls.find((c) => c.method === "PUT")!;
    const body = Buffer.from((put.body as { content: string }).content, "base64").toString("utf8");
    expect(body).toContain("issuerConfirmed");
    expect(body).toContain("Suggested id: `scotiabank-scotia-platinum-amex`");
    expect(body).not.toMatch(/pointsPerCad|cashback.*rate|earnRules/);
  });

  it("returns the existing PR instead of opening a second one", async () => {
    const gh = fakeGitHub({ "GET /repos/o/r/pulls?": json([{ html_url: "https://github.com/o/r/pull/3" }]) });
    const result = await openCatalogueRequestPr(input, { token: "t", repo: "o/r", fetchImpl: gh.impl });
    expect(result).toEqual({ ok: true, url: "https://github.com/o/r/pull/3" });
    expect(gh.calls.some((c) => c.method === "POST" && c.url.endsWith("/pulls"))).toBe(false);
  });

  it("reports a GitHub failure rather than claiming success", async () => {
    const gh = fakeGitHub({ "GET /repos/o/r/git/ref": json({ message: "Not Found" }, false, 404) });
    const result = await openCatalogueRequestPr(input, { token: "t", repo: "o/r", fetchImpl: gh.impl });
    expect(result.ok).toBe(false);
  });

  it("never puts the token in the returned error", async () => {
    const gh = fakeGitHub({ "GET /repos/o/r/git/ref": json({ message: "bad" }, false, 401) });
    const result = await openCatalogueRequestPr(input, { token: "super-secret-token", repo: "o/r", fetchImpl: gh.impl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("super-secret-token");
  });
});
