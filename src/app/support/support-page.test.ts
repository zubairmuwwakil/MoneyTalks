import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Support Page", () => {
  const pagePath = path.resolve(__dirname, "page.tsx");
  const proxyPath = path.resolve(__dirname, "../../proxy.ts");

  it("exists and defines a static page export", () => {
    expect(fs.existsSync(pagePath)).toBe(true);
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toMatch(/export default function SupportPage/);
    expect(content).toMatch(/export const dynamic = "force-static"/);
  });

  it("provides reachable contact email and App Store support URL metadata", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toMatch(/zmuwwakil1@gmail\.com/);
    expect(content).toMatch(/https:\/\/moneytalks\.zubairmuwwakil\.com\/support/);
  });

  it("includes essential self-service links and FAQ items", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toMatch(/\/privacy/);
    expect(content).toMatch(/\/settings\/privacy/);
    expect(content).toMatch(/\/cards/);
    expect(content).toMatch(/Frequently Asked Questions/);
  });

  it("is registered as a public route in Clerk proxy matcher", () => {
    const proxyContent = fs.readFileSync(proxyPath, "utf-8");
    expect(proxyContent).toMatch(/"\/support"/);
  });
});
