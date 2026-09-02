"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { getSessionAccount } from "@/lib/require-user";

export async function setAgentAccessPaused(formData: FormData) {
  const account = await getSessionAccount();
  if (!account) throw new Error("Sign in to manage connected agents.");
  const paused = formData.get("paused");
  if (paused !== "true" && paused !== "false") throw new Error("Invalid access setting.");
  const client = await clerkClient();
  await client.users.updateUserMetadata(account.clerkId, { privateMetadata: { inunityMcpPaused: paused === "true" } });
  revalidatePath("/settings/connected-agents");
}
