"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import {
  deleteProviderKey,
  isSupportedProvider,
  saveProviderKey,
} from "@/lib/security/providerKeys";

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
  const key = String(formData.get("apiKey") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();

  if (!isSupportedProvider(provider)) {
    return { ok: false, error: `Unsupported provider: ${provider}` };
  }
  if (!key) {
    return { ok: false, error: "Enter a key." };
  }
  // These characters are the header's own delimiters; a key containing one would
  // corrupt every other provider's key in the same request.
  if (key.includes(",") || key.includes("=")) {
    return { ok: false, error: "That key contains a character this service cannot transmit safely (, or =)." };
  }

  try {
    await saveProviderKey(prisma, userId, provider, key, label || undefined);
  } catch {
    // Almost always a missing/misconfigured SECRET_ENC_KEY. Say what it means
    // without leaking configuration detail to the browser.
    return { ok: false, error: "Could not store the key securely. Credential encryption is not configured." };
  }

  revalidatePath("/settings/providers");
  return { ok: true, message: `${provider} key stored. It will be used for your next price refresh.` };
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
