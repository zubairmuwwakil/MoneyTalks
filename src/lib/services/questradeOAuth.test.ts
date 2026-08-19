import { describe, expect, it, vi } from "vitest";
import { exchangeQuestradeRefreshToken, formatQuestradeCredential } from "./questradeOAuth";

describe("exchangeQuestradeRefreshToken", () => {
  it("parses valid Questrade OAuth response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "test_access_token_123",
        refresh_token: "test_new_refresh_token_456",
        api_server: "https://api02.iq.questrade.com/",
        expires_in: 3600,
      }),
    });

    const result = await exchangeQuestradeRefreshToken("initial_refresh_token", mockFetch as unknown as typeof fetch);

    expect(result).toEqual({
      accessToken: "test_access_token_123",
      refreshToken: "test_new_refresh_token_456",
      apiServer: "https://api02.iq.questrade.com/",
      expiresIn: 3600,
    });
  });

  it("returns null on non-200 HTTP response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });

    const result = await exchangeQuestradeRefreshToken("bad_token", mockFetch as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null on missing tokens", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: "invalid_grant",
      }),
    });

    const result = await exchangeQuestradeRefreshToken("bad_token", mockFetch as unknown as typeof fetch);
    expect(result).toBeNull();
  });
});

describe("formatQuestradeCredential", () => {
  it("formats token and server URL with trailing slash stripped", () => {
    expect(formatQuestradeCredential("tok123", "https://api01.iq.questrade.com/"))
      .toBe("tok123@https://api01.iq.questrade.com");
  });

  it("returns raw token when server is omitted", () => {
    expect(formatQuestradeCredential("tok123")).toBe("tok123");
  });
});
