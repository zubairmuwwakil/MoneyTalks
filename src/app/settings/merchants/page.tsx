import Link from "next/link";
import { Coins, Tag } from "lucide-react";
import { requireUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { getUnresolvedMerchantCurrencies } from "@/lib/domain/recurring/unresolvedMerchantCurrencies";
import MerchantAliasesClient, { type MerchantAliasItem } from "./MerchantAliasesClient";
import MerchantCurrenciesClient from "./MerchantCurrenciesClient";

export default async function MerchantSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const userId = await requireUserId();
  const params = searchParams ? await searchParams : {};
  const rawTab = Array.isArray(params?.tab) ? params.tab[0] : params?.tab;

  // 1. Fetch user's distinct merchant observations, purchases, timezone, and unresolved currencies in parallel
  const [walletEvents, purchases, preference] = await Promise.all([
    prisma.walletEvent.findMany({
      where: { userId, merchantRaw: { not: null } },
      select: { merchantRaw: true, merchantNormalized: true },
    }),
    prisma.purchase.findMany({
      where: { userId },
      select: { merchant: true },
    }),
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
  ]);

  const currencySummary = await getUnresolvedMerchantCurrencies(
    prisma,
    userId,
    preference?.timezone || undefined,
  );

  const rawStrings = [
    ...new Set(
      walletEvents
        .map((w) => w.merchantRaw)
        .filter((s): s is string => Boolean(s && s.trim().length > 0)),
    ),
  ];

  const purchaseMerchants = [
    ...new Set(
      purchases
        .map((p) => p.merchant)
        .filter((s): s is string => Boolean(s && s.trim().length > 0)),
    ),
  ];

  // 2. Query MerchantAlias rows that appear in the signed-in user's data
  const orConditions = [];
  if (rawStrings.length > 0) {
    orConditions.push({ rawString: { in: rawStrings } });
  }
  if (purchaseMerchants.length > 0) {
    orConditions.push({ normalizedName: { in: purchaseMerchants } });
    orConditions.push({ rawString: { in: purchaseMerchants } });
  }

  const aliases =
    orConditions.length > 0
      ? await prisma.merchantAlias.findMany({
          where: { OR: orConditions },
          orderBy: [{ normalizedName: "asc" }, { rawString: "asc" }],
        })
      : [];

  // 3. Compute per-alias sighting counts in the user's data
  const items: MerchantAliasItem[] = aliases.map((alias) => {
    const walletCount = walletEvents.filter((w) => w.merchantRaw === alias.rawString).length;
    const purchaseCount = purchases.filter(
      (p) => p.merchant === alias.normalizedName || p.merchant === alias.rawString,
    ).length;

    return {
      id: alias.id,
      rawString: alias.rawString,
      normalizedName: alias.normalizedName,
      category: alias.category,
      sightingsCount: Math.max(1, walletCount + purchaseCount),
    };
  });

  const activeTab = rawTab === "aliases" ? "aliases" : "currencies";

  return (
    <main className="max-w-3xl space-y-8 py-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage merchant billing currencies, naming aliases, and category normalization across your transactions.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/settings" className="rounded-full border px-3 py-1 hover:bg-muted">Profile</Link>
          <Link href="/settings/notifications" className="rounded-full border px-3 py-1 hover:bg-muted">Notifications &amp; email</Link>
          <Link href="/settings/wallet" className="rounded-full border px-3 py-1 hover:bg-muted">Apple Wallet</Link>
          <span className="rounded-full bg-foreground px-3 py-1 text-background">Merchants</span>
          <Link href="/settings/providers" className="rounded-full border px-3 py-1 hover:bg-muted">Market data keys</Link>
          <Link href="/settings/automation" className="rounded-full border px-3 py-1 hover:bg-muted">Email automation</Link>
          <Link href="/settings/privacy" className="rounded-full border px-3 py-1 hover:bg-muted">Privacy</Link>
        </div>
      </div>

      {/* Sub-tab Switcher between Currencies and Aliases */}
      <div className="flex items-center gap-2 border-b border-border/70 pb-3">
        <Link
          href="/settings/merchants?tab=currencies"
          className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
            activeTab === "currencies"
              ? "bg-foreground text-background shadow-xs"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Coins className="size-4" />
          <span>Billing Currencies</span>
          {currencySummary.totalMerchantsCount > 0 ? (
            <Badge
              variant={activeTab === "currencies" ? "secondary" : "default"}
              size="sm"
              className={activeTab === "currencies" ? "bg-background text-foreground" : ""}
            >
              {currencySummary.totalMerchantsCount}
            </Badge>
          ) : null}
        </Link>

        <Link
          href="/settings/merchants?tab=aliases"
          className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
            activeTab === "aliases"
              ? "bg-foreground text-background shadow-xs"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Tag className="size-4" />
          <span>Aliases &amp; Categories</span>
          {items.length > 0 ? (
            <Badge
              variant={activeTab === "aliases" ? "secondary" : "muted"}
              size="sm"
              className={activeTab === "aliases" ? "bg-background text-foreground" : ""}
            >
              {items.length}
            </Badge>
          ) : null}
        </Link>
      </div>

      {activeTab === "currencies" ? (
        <MerchantCurrenciesClient initialSummary={currencySummary} />
      ) : (
        <MerchantAliasesClient initialAliases={items} />
      )}
    </main>
  );
}
