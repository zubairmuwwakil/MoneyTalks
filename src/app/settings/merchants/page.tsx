import Link from "next/link";
import { requireUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import MerchantAliasesClient, { type MerchantAliasItem } from "./MerchantAliasesClient";

export default async function MerchantSettingsPage() {
  const userId = await requireUserId();

  // 1. Fetch the signed-in user's distinct merchant observations and purchases.
  // We do NOT fetch or display aliases belonging solely to other users.
  const [walletEvents, purchases] = await Promise.all([
    prisma.walletEvent.findMany({
      where: { userId, merchantRaw: { not: null } },
      select: { merchantRaw: true, merchantNormalized: true },
    }),
    prisma.purchase.findMany({
      where: { userId },
      select: { merchant: true },
    }),
  ]);

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

  return (
    <main className="max-w-3xl space-y-8 py-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage merchant naming and category normalization across your transactions.
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

      <MerchantAliasesClient initialAliases={items} />
    </main>
  );
}
