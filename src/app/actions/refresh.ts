"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fetchUsdCadRate } from "@/lib/fetch-fx";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

/**
 * Redirects back to the dashboard carrying the outcome in a status param
 * so a fetch failure is visible in the UI instead of looking identical to
 * success — the owner needs to be able to tell "it worked" from "the
 * request failed" when verifying this against the live Bank of Canada API.
 * Preserves the current currency toggle (?ccy=) across the round trip.
 */
function redirectWithStatus(ccy: string, param: "fxOk" | "fxError", message: string): never {
  const ccyPart = ccy ? `ccy=${encodeURIComponent(ccy)}&` : "";
  redirect(`/?${ccyPart}${param}=${encodeURIComponent(message)}`);
}

export async function refreshFxRates(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const ccy = String(formData.get("ccy") ?? "");

  const result = await fetchUsdCadRate();
  if (!result) {
    redirectWithStatus(ccy, "fxError", "Could not fetch USD/CAD rate from Bank of Canada. Manual entry still works.");
  }

  await prisma.fxRate.upsert({
    where: {
      userId_base_quote_asOf: { userId, base: "USD", quote: "CAD", asOf: new Date(result.asOf) },
    },
    update: { rate: result.rate },
    create: { userId, base: "USD", quote: "CAD", rate: result.rate, asOf: new Date(result.asOf) },
  });
  revalidatePath("/");
  revalidatePath("/money-finder");

  redirectWithStatus(ccy, "fxOk", `USD/CAD ${result.rate} as of ${result.asOf}`);
}
