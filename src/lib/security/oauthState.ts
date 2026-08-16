// CSRF protection for the Gmail OAuth handshake. Without a verified `state`,
// an attacker can plant their own authorization code in a victim's callback
// request and link the victim's account to the attacker's mailbox.

import { randomBytes } from "node:crypto";
import { secretEquals } from "./secretCrypto";

export const OAUTH_STATE_COOKIE = "gmail_oauth_state";

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidOAuthState(
  cookieValue: string | null | undefined,
  queryValue: string | null | undefined
): boolean {
  if (!cookieValue || !queryValue) return false;
  return secretEquals(cookieValue, queryValue);
}
