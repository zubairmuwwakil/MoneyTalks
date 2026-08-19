/**
 * Questrade OAuth token exchange and credential formatting.
 *
 * Questrade uses rotating refresh tokens: exchanging a refresh token returns a
 * new access_token, api_server, and the *next* refresh_token.
 */

export interface QuestradeTokenResponse {
  accessToken: string;
  refreshToken: string;
  apiServer: string;
  expiresIn: number;
}

export const QUESTRADE_AUTH_URL = "https://login.questrade.com/oauth2/token";

export async function exchangeQuestradeRefreshToken(
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<QuestradeTokenResponse | null> {
  const token = refreshToken.trim();
  if (!token) return null;

  const url = `${QUESTRADE_AUTH_URL}?grant_type=refresh_token&refresh_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = typeof data.access_token === "string" ? data.access_token.trim() : null;
    const newRefreshToken = typeof data.refresh_token === "string" ? data.refresh_token.trim() : null;
    const apiServer = typeof data.api_server === "string" ? data.api_server.trim() : "https://api01.iq.questrade.com";
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 1800;

    if (!accessToken || !newRefreshToken) {
      return null;
    }

    return {
      accessToken,
      refreshToken: newRefreshToken,
      apiServer,
      expiresIn,
    };
  } catch {
    return null;
  }
}

/**
 * Encodes access token and api server for MarketLens X-Provider-Key transmission.
 * Format: `<accessToken>@<apiServer>`
 */
export function formatQuestradeCredential(accessToken: string, apiServer?: string): string {
  const cleanToken = accessToken.trim();
  if (!apiServer || !apiServer.trim()) {
    return cleanToken;
  }
  const cleanServer = apiServer.trim().replace(/\/+$/, "");
  return `${cleanToken}@${cleanServer}`;
}
