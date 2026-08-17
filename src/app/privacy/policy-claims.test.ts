import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// The published policy is the one document where a stale sentence is a legal
// problem rather than a bug. `PickMe/docs/compliance/account-deletion.md` §5
// lists seven statements in the long-form draft that shipped code contradicts;
// this test pins the corrections so a future edit cannot quietly reintroduce
// one. Each case cites the §5 item it defends.

// Both files: the prose lives in content.ts, but a stray claim added directly
// to the page markup would be just as published.
const source = ["content.ts", "page.tsx"]
  .map((f) => fs.readFileSync(path.resolve(__dirname, f), "utf-8"))
  .join("\n");

// Prose only: JSX tags and className soup would otherwise match phrases that
// never reach the reader.
const prose = source
  .replace(/className=(["'])(?:(?!\1)[\s\S])*\1/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

describe("privacy policy page — retracted claims stay retracted", () => {
  // §5 item 7: renamed to PickMe in d4338e2.
  it("never uses the retired product name", () => {
    expect(prose).not.toMatch(/Canadian Card Copilot/i);
  });

  // §5 item 1, the serious one: false as soon as the app signs in.
  it("does not claim Apple Maps is the only outbound network activity", () => {
    expect(prose).not.toMatch(/only outbound network activity/i);
    expect(prose).not.toMatch(/no server of our own/i);
    expect(prose).not.toMatch(/makes no network requests to us/i);
  });

  // §5 items 2 and 3: false for account holders.
  it("does not claim we hold nothing", () => {
    expect(prose).not.toMatch(/we hold nothing/i);
    expect(prose).not.toMatch(/we will have nothing to send you/i);
    expect(prose).not.toMatch(/we do not collect[^.]*any personal information/i);
  });

  // §5 item 4: the iOS app has no export control; only the web hub does.
  it("does not promise an in-app export", () => {
    expect(prose).not.toMatch(/Settings\s*(→|->|&rarr;)\s*Export/i);
  });

  // §5 item 5: per-record delete was never built.
  it("does not promise per-record deletion", () => {
    expect(prose).not.toMatch(/delet(e|ing) individual records/i);
  });
});

describe("privacy policy page — required disclosures", () => {
  it("states the two-store split rather than a blanket denial", () => {
    expect(prose).toMatch(/never uploaded|never leaves your iPhone|never transmitted/i);
    expect(prose).toMatch(/if you have a PickMe account|server/i);
  });

  it("discloses the Wallet Shortcut posting transactions to the server", () => {
    expect(prose).toMatch(/Wallet Shortcut/i);
    expect(prose).toMatch(/wallet-events/i);
  });

  it("discloses that the Shortcut can send retained precise coordinates", () => {
    expect(prose).toMatch(/latitude|coordinates/i);
    expect(prose).toMatch(/Get Current Location/i);
  });

  it("discloses the real Gmail scope rather than implying a narrower one", () => {
    expect(prose).toMatch(/gmail\.readonly/i);
  });

  it("describes all three deletion controls", () => {
    expect(prose).toMatch(/Erase this iPhone|Erase This iPhone's History/i);
    expect(prose).toMatch(/Delete my data/i);
    expect(prose).toMatch(/Delete account|Delete Account/i);
  });

  it("names the statutes and the regulators", () => {
    expect(prose).toMatch(/PIPEDA/);
    expect(prose).toMatch(/Law 25/);
    expect(prose).toMatch(/Privacy Commissioner/i);
    expect(prose).toMatch(/Commission d'accès à l'information|Commission d'acces/i);
  });

  it("gives a reachable contact", () => {
    expect(prose).toMatch(/zmuwwakil1@gmail\.com/);
  });

  // Placeholders are fine in the working draft, never on the published page.
  it("ships no unresolved placeholders", () => {
    expect(source).not.toMatch(/\[\[[A-Z ]+\]\]/);
  });
});
