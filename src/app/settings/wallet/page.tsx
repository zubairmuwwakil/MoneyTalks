import { getSessionUserId } from "@/lib/require-user";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import WalletSettingsClient from "./WalletSettingsClient";
import CardMappingSection from "./CardMappingSection";

export default async function WalletSettingsPage() {
  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/login");
  }

  const [unmappedGroups, aliases, cards] = await Promise.all([
    prisma.walletEvent.groupBy({
      by: ["cardRaw"],
      where: { userId: userId!, cardRaw: { not: null } },
      _count: { _all: true },
    }),
    prisma.cardAlias.findMany({ where: { userId: userId! }, select: { rawString: true } }),
    prisma.creditCard.findMany({
      where: { userId: userId!, contractCardId: { not: null } },
      orderBy: { nickname: "asc" },
      select: { nickname: true, contractCardId: true },
    }),
  ]);

  const mapped = new Set(aliases.map((a) => a.rawString));
  const unmapped = unmappedGroups
    .filter((g) => g.cardRaw != null && !mapped.has(g.cardRaw))
    .map((g) => ({ rawString: g.cardRaw!, tapCount: g._count._all }));

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold mb-6">Apple Wallet Integrations</h1>
      <WalletSettingsClient />
      <CardMappingSection
        unmapped={unmapped}
        cards={cards.map((c) => ({ nickname: c.nickname, contractCardId: c.contractCardId! }))}
      />
    </div>
  );
}
