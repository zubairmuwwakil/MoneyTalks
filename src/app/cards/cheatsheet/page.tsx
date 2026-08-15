import { cheatSheet } from "@/engine/cards/roi";
import { CATEGORY_LABELS, type CardDef, type CardRewards } from "@/engine/cards/types";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function CheatSheetPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({ where: { userId } });
  const defs: CardDef[] = cards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const sheet = cheatSheet(defs, new Date().toISOString().slice(0, 10));

  return (
    <main className="py-8 print:py-0">
      <h1 className="text-xl font-semibold print:text-base">Wallet cheat sheet</h1>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {sheet.map((row) => (
            <tr key={row.category} className="border-b">
              <td className="py-2 pr-4 font-medium">{CATEGORY_LABELS[row.category]}</td>
              <td className="py-2">
                {row.best ? (
                  <>
                    {row.best.nickname}{" "}
                    <span className="text-xs text-muted-foreground">({row.best.pct.toFixed(1)}%)</span>
                  </>
                ) : (
                  "-"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-muted-foreground print:hidden">
        Defaults assume Amex accepted and domestic currency; warehouse assumes Mastercard-only. Print or screenshot for the
        wallet.
      </p>
    </main>
  );
}
