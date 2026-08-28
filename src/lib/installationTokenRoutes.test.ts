import { describe, expect, it } from "vitest";
import { INSTALLATION_TOKEN_ROUTE_PATTERNS } from "./installationTokenRoutes";

describe("installation-token route policy", () => {
  it("lets every installation-token handler authenticate its own bearer token", () => {
    expect(INSTALLATION_TOKEN_ROUTE_PATTERNS).toEqual([
      "/api/v1/wallet-events",
      "/api/v1/wallet-installations/test",
      "/api/v1/wallet-installations/revoke",
    ]);
  });

  it("does not exempt the Clerk-authenticated installation management route", () => {
    expect(INSTALLATION_TOKEN_ROUTE_PATTERNS).not.toContain("/api/v1/wallet-installations");
  });
});
