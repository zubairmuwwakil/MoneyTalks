"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fetchUsdCadRate } from "@/lib/fetch-fx";
import { fetchCryptoPricesMinor } from "@/lib/fetch-prices";
import { isMarketLensConfigured } from "@/lib/services/marketlens";
import { refreshHoldingPrices } from "@/lib/domain/investments/refreshHoldingPrices";
import { captureInvestmentSnapshots } from "@/lib/domain/investments/captureInvestmentSnapshots";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

type StatusParam = "fxOk" | "fxError" | "pricesOk" | "pricesError";

/**
 * Redirects to `path` carrying the outcome in a `param` query string so a
 * fetch failure is visible in the UI instead of looking identical to
 * success — the owner needs to be able to tell "it worked" from "the
 * request failed" when verifying this against a live external API. `path`
 * may already carry its own query string (e.g. the dashboard's `?ccy=`
 * toggle), in which case the status param is appended with `&`. `param` is
 * restricted to the known status keys so a typo'd param name is a compile
 * error instead of a status line that silently never renders.
 */
function redirectWithStatus(path: string, param: StatusParam, message: string): never {
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
 * Refreshes one account's holding prices.
 *
 * Two providers, split by what each actually owns. Equities go to MarketLens,
 * the ecosystem's single owner of market data (E3) — this file must never grow
 * its own equity price fetch. Crypto still uses CoinGecko directly, because
 * MarketLens is equities-only until that capability is ported to it; that
 * exception is recorded, not accidental.
 *
 * Every failure path leaves stored prices untouched and says so. A holding whose
 * price could not be refreshed keeps its last-known value and is shown with its
 * true age, which is the whole point: valuation must never hard-depend on a live
 * fetch.
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

  if (account.type === "CRYPTO") {
    const crypto = await refreshCryptoPrices(account);
    await captureInvestmentSnapshots(prisma, userId);
    revalidatePath(path);
    revalidatePath("/investments");
    revalidatePath("/");
    redirectWithStatus(
      path,
      "pricesOk",
      `${crypto.updated} updated, ${crypto.failed} failed (CoinGecko). Manual entry always works.`,
    );
  }

  if (!isMarketLensConfigured()) {
    await captureInvestmentSnapshots(prisma, userId);
    redirectWithStatus(
      path,
      "pricesError",
      "Market data service is not configured (MARKETLENS_BASE_URL / MARKETLENS_API_KEY). Manual entry still works.",
    );
  }

  const outcome = await refreshHoldingPrices(prisma, userId, { accountId });
  await captureInvestmentSnapshots(prisma, userId);

  revalidatePath(path);
  revalidatePath("/investments");
  revalidatePath("/");

  if (outcome.reason === "no-holdings") {
    redirectWithStatus(path, "pricesError", "This account has no holdings to price.");
  }
  if (outcome.reason === "fetch-failed") {
    redirectWithStatus(
      path,
      "pricesError",
      "Market data service unreachable. Existing prices are unchanged — they are shown with their real age.",
    );
  }

  const sources = Object.entries(outcome.sources)
    .map(([source, count]) => `${count} via ${source}`)
    .join(", ");
  const skippedNote = outcome.skipped.length
    ? ` ${outcome.skipped.length} unchanged (${summarizeSkips(outcome.skipped)}).`
    : "";

  redirectWithStatus(
    path,
    "pricesOk",
    `${outcome.updated} priced at the latest close${sources ? ` (${sources})` : ""}.${skippedNote}`,
  );
}

/** Groups skip reasons so the message names causes rather than listing symbols. */
function summarizeSkips(skipped: { reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const skip of skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([reason, count]) => `${count} ${reason.replace(/-/g, " ")}`)
    .join(", ");
}

/**
 * Crypto auto-fetch via CoinGecko, batched into a single request.
 *
 * One request rather than one per holding because this deploys to a platform
 * that caps serverless functions at ten seconds: a sequential loop with a 5s
 * timeout each can exceed that with just two unresolvable coins, killing the
 * function after some holdings were written but before the redirect ran.
 */
async function refreshCryptoPrices(
  account: { id: string; currency: string; holdings: { id: string; symbol: string }[] },
): Promise<{ updated: number; failed: number }> {
  const prices = await fetchCryptoPricesMinor(
    account.holdings.map((h) => h.symbol),
    account.currency,
  );

  let updated = 0;
  let failed = 0;
  for (const holding of account.holdings) {
    const price = prices[holding.symbol.toUpperCase()];
    if (price === undefined) {
      failed += 1;
      continue;
    }
    await prisma.holding.update({
      where: { id: holding.id },
      data: {
        lastPriceMinor: price,
        priceAsOf: new Date(),
        // CoinGecko quotes in the currency we asked for, so this is known rather
        // than assumed — and recording it keeps null meaning "manually entered".
        priceCurrency: account.currency.toUpperCase(),
        priceSource: "COINGECKO",
        priceStatus: "FRESH",
      },
    });
    updated += 1;
  }
  return { updated, failed };
}
