import { notFound } from "next/navigation";
import Link from "next/link";
import { addCapUsage, deleteCard, setRewardsEstimate, toggleCardCondition, toggleCredit } from "@/app/cards/actions";
import { cardVerdict, isBestSomewhere, type RedeemedCredit } from "@/engine/cards/roi";
import {
  activeBaseRateOverride,
  capForBaseRateOverride,
  capForRate,
  CATEGORY_LABELS,
  effectiveAnnualFeeMinor,
  periodKeyFor,
  type CapUsage,
  type CardDef,
  type CardRewards,
} from "@/engine/cards/types";
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
  const effectiveFee = effectiveAnnualFeeMinor(def);
  const capEntries = rewards.categoryRates.reduce<Array<{ id: string; cap: NonNullable<ReturnType<typeof capForRate>> }>>(
    (entries, rate) => {
      const cap = capForRate(rewards, rate);
      if (cap && !entries.some((entry) => entry.id === cap.id)) entries.push({ id: cap.id, cap });
      return entries;
    },
    [],
  );
  const baseRateOverride = activeBaseRateOverride(rewards);
  const baseRateCap = baseRateOverride ? capForBaseRateOverride(rewards, baseRateOverride) : undefined;
  if (baseRateCap && baseRateCap.categories.length > 0 && !capEntries.some((entry) => entry.id === baseRateCap.id)) {
    capEntries.push({ id: baseRateCap.id, cap: baseRateCap });
  }

  async function toggleCreditAction(formData: FormData) {
    "use server";
    await toggleCredit(formData);
  }

  async function addCapUsageAction(formData: FormData) {
    "use server";
    await addCapUsage(formData);
  }

  async function toggleConditionAction(formData: FormData) {
    "use server";
    await toggleCardCondition(formData);
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{card.nickname}</h1>
          <Link href={`/cards/${card.id}/edit`} className="rounded border px-3 py-1 text-sm hover:bg-muted/50">
            Edit card
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          {card.issuer} - {card.network}
          {card.lastFour ? ` - ...${card.lastFour}` : ""} - effective fee {formatMinorUnits(effectiveFee, "CAD")}/yr
          {effectiveFee !== card.annualFeeMinor ? ` (published ${formatMinorUnits(card.annualFeeMinor, "CAD")})` : ""}
        </p>
        <p className="mt-2 text-sm">
          Realized value {formatMinorUnits(verdict.realizedMinor, "CAD")} - fee ={" "}
          <span className="font-medium tabular-nums">{formatMinorUnits(verdict.netMinor, "CAD")}</span> -{" "}
          <span className="font-semibold">{verdict.verdict.replace("_", " ")}</span>
        </p>
      </header>

      {rewards.conditions?.length ? (
        <section>
          <h2 className="font-medium">Wallet conditions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep these in sync with your accounts and eligibility. They change only the affected rewards or fee waiver.
          </p>
          <ul className="mt-2 divide-y rounded border">
            {rewards.conditions.map((condition) => (
              <li key={condition.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {condition.label} <span className="text-xs text-muted-foreground">({condition.enabled ? "active" : "off"})</span>
                  {condition.annualFeeReductionMinor ? (
                    <span className="block text-xs text-muted-foreground">
                      Reduces annual fee by {formatMinorUnits(condition.annualFeeReductionMinor, "CAD")} while active.
                    </span>
                  ) : null}
                </span>
                <form action={toggleConditionAction}>
                  <input type="hidden" name="cardId" value={card.id} />
                  <input type="hidden" name="conditionId" value={condition.id} />
                  <button type="submit" className="rounded border px-2 py-0.5 text-xs hover:bg-muted/50">
                    {condition.enabled ? "turn off" : "turn on"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rewards.baseRateOverrides?.length ? (
        <section>
          <h2 className="font-medium">All-spend conditional rates</h2>
          <ul className="mt-2 divide-y rounded border">
            {rewards.baseRateOverrides.map((rate) => {
              const condition = rewards.conditions?.find((candidate) => candidate.id === rate.requiresConditionId);
              return (
                <li key={rate.id} className="px-4 py-3 text-sm">
                  {rate.label} <span className="font-medium">{rate.multiplier}x</span>
                  <span className="text-xs text-muted-foreground"> - {condition?.enabled ? "active" : "off"}</span>
                  {rate.capMinor ? <span className="text-xs text-muted-foreground"> - {formatMinorUnits(rate.capMinor, "CAD")} {rate.capWindow?.toLowerCase() ?? "monthly"} spend cap</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rewards.credits.length > 0 ? (
        <section>
          <h2 className="font-medium">Recurring credits & benefits</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mark a credit only after you use it in this month or year, so the fee verdict reflects real value.
          </p>
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

      {rewards.merchantRates?.length ? (
        <section>
          <h2 className="font-medium">Merchant-specific bonuses</h2>
          <p className="mt-1 text-sm text-muted-foreground">The picker will surface these merchants when you search for them.</p>
          <ul className="mt-2 divide-y rounded border">
            {rewards.merchantRates.map((rate) => {
              const condition = rate.requiresConditionId
                ? rewards.conditions?.find((candidate) => candidate.id === rate.requiresConditionId)
                : undefined;
              return (
                <li key={rate.id} className="px-4 py-3 text-sm">
                  {rate.merchant} <span className="font-medium">{rate.multiplier}x</span>
                  {condition ? <span className="text-xs text-muted-foreground"> - {condition.label}: {condition.enabled ? "active" : "off"}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {capEntries.length > 0 ? (
        <section>
          <h2 className="font-medium">Caps</h2>
          <ul className="mt-2 divide-y rounded border">
            {capEntries.map(({ id, cap }) => {
                const key = periodKeyFor(cap.capWindow, today);
                const used = usage
                  .filter((u) => cap.categories.includes(u.category) && u.periodKey === key)
                  .reduce((sum, u) => sum + u.usedMinor, 0);
                const pct = Math.min(100, Math.round((used / cap.capMinor) * 100));
                return (
                  <li key={id} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span>
                        {cap.label} ({cap.capWindow.toLowerCase()})
                        {cap.allSpend
                          ? " - all spend"
                          : cap.categories.length > 1
                            ? ` - ${cap.categories.map((category) => CATEGORY_LABELS[category]).join(", ")}`
                            : ""}
                      </span>
                      <span className="tabular-nums">
                        {formatMinorUnits(used, "CAD")} / {formatMinorUnits(cap.capMinor, "CAD")} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-muted">
                      <div className="h-1.5 rounded bg-foreground" style={{ width: `${pct}%` }} />
                    </div>
                    <form action={addCapUsageAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="cardId" value={card.id} />
                      {cap.categories.length === 1 ? (
                        <input type="hidden" name="category" value={cap.categories[0]} />
                      ) : (
                        <select name="category" aria-label={`Category for ${cap.label}`} className="rounded border px-2 py-1 text-xs">
                          {cap.categories.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
                        </select>
                      )}
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
