import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCardArtworkUrl, getCardAssetsBaseUrl } from "./cardArt";

describe("cardArt", () => {
  const originalEnv = process.env.NEXT_PUBLIC_CARD_ASSETS_BASE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_CARD_ASSETS_BASE_URL;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_CARD_ASSETS_BASE_URL = originalEnv;
  });

  it("defaults base URL to /cards when env var is missing", () => {
    expect(getCardAssetsBaseUrl()).toBe("/cards");
  });

  it("uses NEXT_PUBLIC_CARD_ASSETS_BASE_URL when provided and trims trailing slashes", () => {
    process.env.NEXT_PUBLIC_CARD_ASSETS_BASE_URL = "https://pub-12345.r2.dev/cards/";
    expect(getCardAssetsBaseUrl()).toBe("https://pub-12345.r2.dev/cards");
  });

  it("resolves artwork URL by cardId convention", () => {
    expect(getCardArtworkUrl("amex-cobalt")).toBe("/cards/amex-cobalt.webp");
  });

  it("resolves artwork URL with R2 base URL when set", () => {
    process.env.NEXT_PUBLIC_CARD_ASSETS_BASE_URL = "https://pub-12345.r2.dev/cards";
    expect(getCardArtworkUrl("amex-cobalt")).toBe("https://pub-12345.r2.dev/cards/amex-cobalt.webp");
  });

  it("handles custom absolute image URLs directly", () => {
    expect(getCardArtworkUrl("amex-cobalt", "https://custom.cdn.com/my-card.png")).toBe(
      "https://custom.cdn.com/my-card.png"
    );
  });

  it("returns null for missing or empty cardId", () => {
    expect(getCardArtworkUrl("")).toBeNull();
    expect(getCardArtworkUrl(null)).toBeNull();
    expect(getCardArtworkUrl(undefined)).toBeNull();
  });
});
