import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProviderHosts } from "./check-no-market-data-provider.mjs";

function tree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "mdp-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("findProviderHosts", () => {
  it("flags a direct Alpha Vantage call", () => {
    const root = tree({ "a.ts": 'fetch("https://www.alphavantage.co/query?f=x")' });
    expect(findProviderHosts(root, []).map((hit) => hit.host)).toEqual(["alphavantage.co"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a Yahoo quote endpoint", () => {
    const root = tree({ "a.ts": 'const u = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL"' });
    expect(findProviderHosts(root, []).map((hit) => hit.host)).toEqual(["finance.yahoo.com"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not flag the MarketLens base URL — consuming the service is the point", () => {
    const root = tree({ "a.ts": 'fetch(`${process.env.MARKETLENS_BASE_URL}/api/v1/quotes`)' });
    expect(findProviderHosts(root, [])).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("honours an exemption path", () => {
    const root = tree({ "lib/fetch-prices.ts": 'fetch("https://api.coingecko.com/api/v3/simple/price")' });
    expect(findProviderHosts(root, ["lib/fetch-prices.ts"])).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags CoinGecko outside the exempt path", () => {
    const root = tree({ "lib/elsewhere.ts": 'fetch("https://api.coingecko.com/api/v3/simple/price")' });
    expect(findProviderHosts(root, ["lib/fetch-prices.ts"]).map((hit) => hit.host)).toEqual([
      "api.coingecko.com",
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});
