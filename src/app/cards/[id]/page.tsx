import { notFound } from "next/navigation";
import { addCapUsage, deleteCard, setRewardsEstimate, toggleCredit } from "@/app/cards/actions";
import { cardVerdict, isBestSomewhere, type RedeemedCredit } from "@/engine/cards/roi";
import { CATEGORY_LABELS, periodKeyFor, type CapUsage, type CardDef, type CardRewards } from "@/engine/cards/types";
import { formatMinorUnits, minorToDollarInput } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const card = await prisma.creditCard.findFirst({ where: { id, userId }, include: { state: true } });
  if (!card) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const rewards = card.rewards as unknown as CardRewards;
  const redeemed = (card.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? [];
  const usage = (card.state?.capsUsage as unknown as CapUsage[]) ?? [];

  const allCards = await prisma.creditCard.findMany({ where: { userId } });
  const defs: CardDef[] = allCards.map((c) => ({
    id: c.id,
    nickname: c.nickname,
    network: c.network as CardDef["network"],
    annualFeeMinor: c.annualFeeMinor,
    rewards: c.rewards as unknown as CardRewards,
  }));
  const def = defs.find((d) => d.id === card.id);
  if (!def) notFound();
  const verdict = cardVerdict(def, redeemed, card.state?.rewardsEstimateMinor ?? 0, isBestSomewhere(def, defs, today), today);

  async function toggleCreditAction(formData: FormData) {
    "use server";
    await toggleCredit(formData);
  }

  async function addCapUsageAction(formData: FormData) {
    "use server";
    await addCapUsage(formData);
  }

  async function setRewardsEstimateAction(formData: FormData) {
    "use server";
    await setRewardsEstimate(formData);
  }

  async function deleteCardAction(formData: FormData) {
    "use server";
    await deleteCard(formData);
  }

  return (
    <main className="space-y-8 py-8">
      <header>
        <h1 className="text-xl font-semibold">{card.nickname}</h1>
        <p className="text-sm text-muted-foreground">
          {card.issuer} - {card.network}
          {card.lastFour ? ` - ...${card.lastFour}` : ""} - fee {formatMinorUnits(card.annualFeeMinor, "CAD")}/yr
        </p>
        <p className="mt-2 text-sm">
          Realized value {formatMinorUnits(verdict.realizedMinor, "CAD")} - fee ={" "}
          <span className="font-medium tabular-nums">{formatMinorUnits(verdict.netMinor, "CAD")}</span> -{" "}
          <span className="font-semibold">{verdict.verdict.replace("_", " ")}</span>
        </p>
      </header>

      {rewards.credits.length > 0 ? (
        <section>
          <h2 className="font-medium">Credits checklist</h2>
          <ul className="mt-2 divide-y rounded border">
            {rewards.credits.map((credit) => {
              const key = periodKeyFor(credit.period, today);
              const done = redeemed.some((r) => r.creditId === credit.id && r.periodKey === key);
              return (
                <li key={credit.id} className="flex flex-col gap-2 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {credit.label}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatMinorUnits(credit.valueMinor, "CAD")}/{credit.period.toLowerCase()})
                    </span>
                  </span>
                  <form action={toggleCreditAction}>
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="creditId" value={credit.id} />
                    <button type="submit" className="rounded border px-2 py-0.5 text-xs hover:bg-muted/50">
                      {done ? "redeemed - undo" : "mark redeemed"}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rewards.categoryRates.some((r) => r.capMinor !== undefined) ? (
        <section>
          <h2 className="font-medium">Caps</h2>
          <ul className="mt-2 divide-y rounded border">
            {rewards.categoryRates
              .filter((r) => r.capMinor !== undefined)
              .map((rate) => {
                const key = periodKeyFor(rate.capWindow ?? "MONTH", today);
                const used = usage
                  .filter((u) => u.category === rate.category && u.periodKey === key)
                  .reduce((sum, u) => sum + u.usedMinor, 0);
                const pct = Math.min(100, Math.round((used / (rate.capMinor ?? 1)) * 100));
                return (
                  <li key={rate.category} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span>
                        {CATEGORY_LABELS[rate.category]} ({rate.capWindow?.toLowerCase()})
                      </span>
                      <span className="tabular-nums">
                        {formatMinorUnits(used, "CAD")} / {formatMinorUnits(rate.capMinor ?? 0, "CAD")} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-muted">
                      <div className="h-1.5 rounded bg-foreground" style={{ width: `${pct}%` }} />
                    </div>
                    <form action={addCapUsageAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="category" value={rate.category} />
                      <input name="amount" placeholder="Add spend ($)" className="w-40 rounded border px-2 py-1 text-xs" />
                      <button type="submit" className="rounded border px-2 py-1 text-xs hover:bg-muted/50">
                        add
                      </button>
                    </form>
                  </li>
                );
              })}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="font-medium">Rewards earned this year (estimate)</h2>
        <form action={setRewardsEstimateAction} className="mt-2 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="cardId" value={card.id} />
          <input
            name="rewardsEstimate"
            aria-label="Rewards earned this year in dollars"
            defaultValue={minorToDollarInput(card.state?.rewardsEstimateMinor ?? 0)}
            className="w-40 rounded border px-2 py-1"
          />
          <button type="submit" className="rounded border px-3 py-1 hover:bg-muted/50">
            Save ($)
          </button>
        </form>
      </section>

      <form action={deleteCardAction}>
        <input type="hidden" name="cardId" value={card.id} />
        <button type="submit" className="rounded border border-red-600 px-3 py-1 text-sm text-red-600 hover:bg-red-50">
          Delete card
        </button>
      </form>
    </main>
  );
}
