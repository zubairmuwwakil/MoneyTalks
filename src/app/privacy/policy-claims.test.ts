import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// The published policy is the one document where a stale sentence is a legal
// problem rather than a bug. `PickMe/docs/compliance/account-deletion.md` §5
// lists seven statements in the long-form draft that shipped code contradicts;
// this test pins the corrections so a future edit cannot quietly reintroduce
// one. Each case cites the §5 item it defends.

// These files together produce the published policy. `publishedSections.ts`
// applies bounded rewrites to older long-form blocks when product behaviour changes.
const source = ["content.ts", "publishedSections.ts", "page.tsx"]
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

  it("discloses the complete owner-state wallet upload", () => {
    expect(prose).toMatch(/complete PickMe wallet configuration/i);
    expect(prose).toMatch(/selected card products/i);
    expect(prose).toMatch(/point or reward valuations/i);
    expect(prose).toMatch(/switching thresholds/i);
    expect(prose).toMatch(/issuer, card product name, and optional note/i);
  });

  it("does not describe signed-in wallet choices as local-only", () => {
    expect(prose).not.toMatch(/choosing a card from it tells nobody anything/i);
    expect(prose).toMatch(/remain only on the device while signed out/i);
  });

  it("discloses Always location and ambient discovery honestly", () => {
    expect(prose).toMatch(/requests Always permission/i);
    expect(prose).toMatch(/significant-location-change/i);
    expect(prose).not.toMatch(/It never requests Always/i);
  });

  it("discloses the Wallet Shortcut posting transactions to the server", () => {
    expect(prose).toMatch(/Wallet Shortcut/i);
    expect(prose).toMatch(/wallet-events/i);
  });

  it("discloses that the Shortcut can send retained precise coordinates", () => {
    expect(prose).toMatch(/latitude|coordinates/i);
    expect(prose).toMatch(/Get Current Location/i);
  });

  it("discloses optional anonymous community gift-card inventory", () => {
    expect(prose).toMatch(/Optional community gift-card inventory/i);
    expect(prose).toMatch(/off by default/i);
    expect(prose).toMatch(/Apple place identifier/i);
    expect(prose).toMatch(/rounded to four decimal places/i);
    expect(prose).toMatch(/Found it or Not here/i);
    expect(prose).toMatch(/do not include your credit card/i);
    expect(prose).toMatch(/90 days/i);
    expect(prose).toMatch(/three evidence units/i);
  });

  it("makes clear community inventory can exist without an account", () => {
    expect(prose).toMatch(/no account is required|do not need a PickMe account/i);
    expect(prose).toMatch(/no user or device relation/i);
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
