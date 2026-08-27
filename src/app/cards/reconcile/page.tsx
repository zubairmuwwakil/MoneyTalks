import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { publishedCards } from "@/lib/contracts/cardCatalogue";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { StatementReconciliationForm } from "./statement-reconciliation-form";

export default async function StatementReconciliationPage() {
  const userId = await requireUserId();
  const [cards, reports] = await Promise.all([
    prisma.creditCard.findMany({ where: { userId }, orderBy: { nickname: "asc" }, select: { id: true, nickname: true, currency: true, contractCardId: true } }),
    prisma.coverageReport.findMany({ where: { userId }, include: { card: { select: { nickname: true } } }, orderBy: [{ month: "desc" }, { updatedAt: "desc" }], take: 24 }),
  ]);
  const contractCards = publishedCards().map((card) => ({ id: card.cardId, label: `${card.officialName} (${card.cardId})` }));

  return (
    <main className="max-w-4xl space-y-6 py-6 sm:py-8">
      <div>
        <Link href="/cards" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="size-3.5" />Back to Wallet</Link>
        <div className="flex items-start gap-3"><FileSpreadsheet className="mt-1 size-5 text-muted-foreground" /><div><h1 className="text-2xl font-bold tracking-tight">Statement reconciliation</h1><p className="mt-1 text-sm text-muted-foreground">Measure how completely Wallet and purchase capture reflect a card statement, then backfill what is missing.</p></div></div>
      </div>

      {cards.length === 0 ? <div className="rounded-xl border border-border/80 bg-card p-5 text-sm text-muted-foreground">Add a card before reconciling a statement.</div> : <StatementReconciliationForm cards={cards.map((card) => ({ ...card, currency: card.currency as "CAD" | "USD" | "JMD" }))} contractCards={contractCards} />}

      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold">Monthly capture coverage</h2>
        <p className="mt-1 text-xs text-muted-foreground">Each new statement replaces that card-month&apos;s compact coverage snapshot; raw statement rows are not retained.</p>
        {reports.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No statement coverage recorded yet.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Month</th><th className="pb-2 font-medium">Card</th><th className="pb-2 text-right font-medium">Coverage</th></tr></thead><tbody className="divide-y">{reports.map((report) => <tr key={report.id}><td className="py-2 tabular-nums">{report.month}</td><td className="py-2">{report.card.nickname}</td><td className="py-2 text-right tabular-nums">{report.eligibleLines === 0 ? "—" : `${Math.round((report.matchedLines / report.eligibleLines) * 100)}%`} <span className="text-xs text-muted-foreground">({report.matchedLines}/{report.eligibleLines})</span></td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
