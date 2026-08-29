import { describe, expect, it } from "vitest";

import { findKnownService } from "./serviceDirectory";

describe("known bill service directory", () => {
  it("resolves Netflix to its account page and bill categories", () => {
    expect(findKnownService("Netflix subscription")).toMatchObject({
      id: "netflix",
      displayName: "Netflix",
      serviceUrl: "https://www.netflix.com/account",
      category: "subscriptions:streaming",
      paymentRail: "card",
    });
  });

  it("matches across nickname and payee inputs", () => {
    expect(findKnownService("Family media", "Spotify Canada")).toMatchObject({ id: "spotify" });
  });

  it("returns null for manual services", () => {
    expect(findKnownService("Neighbourhood snow removal")).toBeNull();
  });
});
