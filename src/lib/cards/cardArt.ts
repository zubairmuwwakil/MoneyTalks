import { catalogueCard } from "./catalogueCard";

/**
 * Returns the configured base URL for card artwork assets.
 * Defaults to local '/cards' if NEXT_PUBLIC_CARD_ASSETS_BASE_URL is not set.
 */
export function getCardAssetsBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_CARD_ASSETS_BASE_URL?.trim();
  if (!envUrl) return "/cards";
  return envUrl.replace(/\/+$/, "");
}

/**
 * Resolves the artwork URL for a given contractCardId, cardId, or custom image override.
 * 
 * Precedence:
 * 1. Explicit customUrl parameter (if passed)
 * 2. Catalogue product's imageUrl (if set in catalogue)
 * 3. Standard R2 / local asset pattern: `${baseUrl}/${cardId}.webp`
 * 
 * Returns null if no valid card identifier or URL is found.
 */
export function getCardArtworkUrl(
  contractCardId?: string | null,
  customUrl?: string | null,
): string | null {
  if (customUrl && customUrl.trim() !== "") {
    const trimmed = customUrl.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
      return trimmed;
    }
    return `${getCardAssetsBaseUrl()}/${trimmed}`;
  }

  if (!contractCardId || contractCardId.trim() === "") {
    return null;
  }

  const normalizedId = contractCardId.trim().toLowerCase();
  const product = catalogueCard(normalizedId);

  if (product?.imageUrl && product.imageUrl.trim() !== "") {
    const trimmed = product.imageUrl.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
      return trimmed;
    }
    return `${getCardAssetsBaseUrl()}/${trimmed}`;
  }

  const baseUrl = getCardAssetsBaseUrl();
  return `${baseUrl}/${normalizedId}.webp`;
}
