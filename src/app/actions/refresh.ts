"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fetchUsdCadRate } from "@/lib/fetch-fx";
import { fetchCryptoPriceMinor } from "@/lib/fetch-prices";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

/**
 * Redirects to `path` carrying the outcome in a `param` query string so a
 * fetch failure is visible in the UI instead of looking identical to
 * success — the owner needs to be able to tell "it worked" from "the
 * request failed" when verifying this against a live external API. `path`
 * may already carry its own query string (e.g. the dashboard's `?ccy=`
 * toggle), in which case the status param is appended with `&`.
 */
function redirectWithStatus(path: string, param: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${param}=${encodeURIComponent(message)}`);
}

export async function refreshFxRates(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const ccy = String(formData.get("ccy") ?? "");
  const ccyPath = ccy ? `/?ccy=${encodeURIComponent(ccy)}` : "/";

  const result = await fetchUsdCadRate();
  if (!result) {
    redirectWithStatus(ccyPath, "fxError", "Could not fetch USD/CAD rate from Bank of Canada. Manual entry still works.");
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

  redirectWithStatus(ccyPath, "fxOk", `USD/CAD ${result.rate} as of ${result.asOf}`);
}

/**
 * Best-effort crypto price refresh for a single account's holdings.
 * Auto-fetch only ever attempts crypto (CoinGecko, in the account's
 * currency) — equity auto-fetch has no free, no-key, server-side source
 * (Stooq's CSV endpoint now 404s; see src/lib/fetch-prices.ts), so
 * non-crypto accounts get an explanatory status instead of a silent no-op.
 * Manual entry always works regardless of account type.
 */
export async function refreshPrices(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const path = `/investments/${accountId}`;

  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    include: { holdings: true },
  });
  if (!account) redirectWithStatus(path, "pricesError", "Account not found.");

  if (account.type !== "CRYPTO") {
    redirectWithStatus(
      path,
      "pricesError",
      "Price auto-fetch covers crypto accounts only; other holdings use manual entry.",
    );
  }

  let updated = 0;
  let failed = 0;
  for (const holding of account.holdings) {
    const price = await fetchCryptoPriceMinor(holding.symbol, account.currency);
    if (price === null) {
      failed += 1;
      continue;
    }
    await prisma.holding.update({
      where: { id: holding.id },
      data: { lastPriceMinor: price, priceAsOf: new Date() },
    });
    updated += 1;
  }
  revalidatePath(path);
  revalidatePath("/");

  redirectWithStatus(path, "pricesOk", `${updated} updated, ${failed} failed (CoinGecko). Manual entry always works.`);
}
