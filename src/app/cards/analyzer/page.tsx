import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { AnalyzerForm } from "./form";

export default async function AnalyzerPage() {
  const userId = await requireUserId();
  const cards = await prisma.creditCard.findMany({
    where: { userId },
    select: { id: true, nickname: true },
    orderBy: { nickname: "asc" },
  });

  return (
    <main className="max-w-2xl space-y-4 py-8">
      <h1 className="text-xl font-semibold">Statement analyzer</h1>
      <p className="text-sm text-muted-foreground">
        Upload one card&apos;s statement CSV. It is parsed in memory and never stored. The report
        shows what the spend earned vs what the wallet&apos;s best cards would have earned.
      </p>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cards yet - add them via{" "}
          <Link href="/cards/manage" className="underline">
            Manage
          </Link>
          .
        </p>
      ) : (
        <AnalyzerForm cards={cards} />
      )}
    </main>
  );
}
