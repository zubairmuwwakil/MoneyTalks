"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import {
  deleteProviderKey,
  isSupportedProvider,
  saveProviderKey,
} from "@/lib/security/providerKeys";
import {
  exchangeQuestradeRefreshToken,
  formatQuestradeCredential,
} from "@/lib/services/questradeOAuth";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Stores a user's own upstream market-data key, encrypted.
 *
 * The plaintext key exists in memory for the length of this call and is never
 * logged, never echoed back, and never placed in a redirect query string — which
 * rules out the tempting "show what you saved" confirmation.
 */
export async function saveProviderCredential(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const provider = String(formData.get("provider") ?? "").trim().toUpperCase();
  const rawKey = String(formData.get("apiKey") ?? "").trim();
  const rawLabel = String(formData.get("label") ?? "").trim();

  if (!isSupportedProvider(provider)) {
    return { ok: false, error: `Unsupported provider: ${provider}` };
  }
  if (!rawKey) {
    return { ok: false, error: "Enter a key." };
  }

  let finalKey = rawKey;
  let finalLabel = rawLabel;
  let successDetail = "";

  if (provider === "QUESTRADE") {
    if (!rawKey.includes("@") && rawKey.length > 20) {
      const exchange = await exchangeQuestradeRefreshToken(rawKey);
      if (exchange) {
        finalKey = formatQuestradeCredential(exchange.accessToken, exchange.apiServer);
        if (!finalLabel && exchange.apiServer) {
          try {
            finalLabel = `Questrade (${new URL(exchange.apiServer).hostname})`;
          } catch {
            finalLabel = "Questrade API";
          }
        }
        successDetail = ` (connected to ${exchange.apiServer})`;
      }
    }
  }

  // These characters are the header's own delimiters; a key containing one would
  // corrupt every other provider's key in the same request.
  if (finalKey.includes(",") || finalKey.includes("=")) {
    return { ok: false, error: "That key contains a character this service cannot transmit safely (, or =)." };
  }

  try {
    await saveProviderKey(prisma, userId, provider, finalKey, finalLabel || undefined);
  } catch {
    // Almost always a missing/misconfigured SECRET_ENC_KEY. Say what it means
    // without leaking configuration detail to the browser.
    return { ok: false, error: "Could not store the key securely. Credential encryption is not configured." };
  }

  revalidatePath("/settings/providers");
  return { ok: true, message: `${provider} key stored${successDetail}. It will be used for your next price refresh.` };
}

export async function removeProviderCredential(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const provider = String(formData.get("provider") ?? "").trim().toUpperCase();
  if (!isSupportedProvider(provider)) {
    return { ok: false, error: `Unsupported provider: ${provider}` };
  }
  await deleteProviderKey(prisma, userId, provider);
  revalidatePath("/settings/providers");
  return { ok: true, message: `${provider} key removed. Prices will fall back to the shared source.` };
}
