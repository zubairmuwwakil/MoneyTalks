import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Terms of Service Page", () => {
  const pagePath = path.resolve(__dirname, "page.tsx");
  const contentPath = path.resolve(__dirname, "content.ts");
  const proxyPath = path.resolve(__dirname, "../../proxy.ts");

  const source = [contentPath, pagePath]
    .map((f) => fs.readFileSync(f, "utf-8"))
    .join("\n");

  const prose = source
    .replace(/className=(["'])(?:(?!\1)[\s\S])*\1/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  it("exists and defines a static page export", () => {
    expect(fs.existsSync(pagePath)).toBe(true);
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toMatch(/export default function TermsOfServicePage/);
    expect(content).toMatch(/export const dynamic = "force-static"/);
  });

  it("provides reachable contact email and publisher details", () => {
    expect(prose).toMatch(/zmuwwakil1@gmail\.com/);
    expect(prose).toMatch(/Zubair Muwwakil/);
  });

  it("includes critical financial, tax, and legal advice disclaimers", () => {
    expect(prose).toMatch(/NOT provide personalized financial, investment, accounting, tax, or legal advice/i);
    expect(prose).toMatch(/registered investment adviser/i);
    expect(prose).toMatch(/solely responsible for verifying your financial decisions/i);
  });

  it("discloses that card issuer contracts take precedence over automated calculations", () => {
    expect(prose).toMatch(/card contract with your issuing bank always supersedes/i);
    expect(prose).toMatch(/Merchant Category Codes/i);
  });

  it("includes disclaimer of warranties and limitation of liability clauses", () => {
    expect(prose).toMatch(/AS IS/);
    expect(prose).toMatch(/LIMITATION OF LIABILITY/i);
    expect(prose).toMatch(/CAD \$50\.00/);
  });

  it("specifies Ontario and Canada governing law", () => {
    expect(prose).toMatch(/Province of Ontario/);
    expect(prose).toMatch(/federal laws of Canada/);
  });

  it("cross-references the Privacy Policy", () => {
    expect(source).toMatch(/\/privacy/);
  });

  it("ships no unresolved placeholders", () => {
    expect(source).not.toMatch(/\[\[[A-Z ]+\]\]/);
  });

  it("is registered as a public route in Clerk proxy matcher", () => {
    const proxyContent = fs.readFileSync(proxyPath, "utf-8");
    expect(proxyContent).toMatch(/"\/terms"/);
  });
});
