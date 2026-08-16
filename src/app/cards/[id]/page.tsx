import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit2,
  Trash2,
} from "lucide-react";
import { addCapUsage, deleteCard, setRewardsEstimate, toggleCardCondition, toggleCredit } from "@/app/cards/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { creditsRealizedMinor, effectiveAnnualFeeMinor, type RedeemedCredit } from "@/lib/cards/fees";
import {
  activeBaseRateOverride,
  capForBaseRateOverride,
  capForRate,
  CATEGORY_LABELS,
  periodKeyFor,
  type CapUsage,
  type CardDef,
  type CardRewards,
} from "@/lib/cards/types";
import { formatMinorUnits, minorToDollarInput } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";

const inputStyle =
  "flex h-8 rounded-lg border border-input bg-background px-2.5 py-1 text-xs shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const card = await prisma.creditCard.findFirst({ where: { id, userId }, include: { state: true } });
  if (!card) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const rewards = card.rewards as unknown as CardRewards;
  const redeemed = (card.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? [];
  const usage = (card.state?.capsUsage as unknown as CapUsage[]) ?? [];

  const def: CardDef = {
    id: card.id,
    nickname: card.nickname,
    network: card.network as CardDef["network"],
    annualFeeMinor: card.annualFeeMinor,
    rewards,
  };
  const effectiveFee = effectiveAnnualFeeMinor(def);
  const realizedMinor = creditsRealizedMinor(rewards.credits, redeemed, today) + (card.state?.rewardsEstimateMinor ?? 0);
  const netMinor = realizedMinor - effectiveFee;
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
    <main className="space-y-8 py-6 sm:py-8">
      <div>
        <Link
          href="/cards"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Wallet</span>
        </Link>

        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{card.nickname}</h1>
              <Badge variant="outline" className="text-xs font-mono">
                {card.network}
              </Badge>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/cards/${card.id}/edit`} className="flex items-center gap-1.5">
                <Edit2 className="size-3" />
                <span>Edit card</span>
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {card.issuer} - {card.network}
            {card.lastFour ? ` - ...${card.lastFour}` : ""} - effective fee {formatMinorUnits(effectiveFee, "CAD")}/yr
            {effectiveFee !== card.annualFeeMinor ? ` (published ${formatMinorUnits(card.annualFeeMinor, "CAD")})` : ""}
          </p>
        </header>
      </div>

      {/* Realized Value Summary Card */}
      <Card className="bg-gradient-to-b from-card to-muted/20">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Net Annual Value
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
                {formatMinorUnits(netMinor, "CAD")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Realized value {formatMinorUnits(realizedMinor, "CAD")} - fee ={" "}
                <span className="font-semibold text-foreground tabular-nums">{formatMinorUnits(netMinor, "CAD")}</span>
              </p>
            </div>
            <div className="text-xs text-muted-foreground space-y-1 sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-border/60">
              <p>Base Earn Rate: <span className="font-semibold text-foreground">{rewards.baseMultiplier ?? 1}x</span></p>
              <p>Point Value: <span className="font-semibold text-foreground">{rewards.pointValueCents ?? 1}¢</span></p>
              <p>FX Fee: <span className="font-semibold text-foreground">{rewards.fxFeePct ?? 0}%</span></p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Wallet Conditions Section */}
      {rewards.conditions?.length ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">Wallet conditions</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep these in sync with your accounts and eligibility. They change only the affected rewards or fee waiver.
          </p>
          <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
            {rewards.conditions.map((condition) => (
              <li
                key={condition.id}
                className="flex flex-col gap-3 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{condition.label}</span>
                    <Badge variant={condition.enabled ? "success" : "muted"} className="text-[10px]">
                      {condition.enabled ? "active" : "off"}
                    </Badge>
                  </div>
                  {condition.annualFeeReductionMinor ? (
                    <span className="block text-xs text-muted-foreground">
                      Reduces annual fee by {formatMinorUnits(condition.annualFeeReductionMinor, "CAD")} while active.
                    </span>
                  ) : null}
                </div>
                <form action={toggleConditionAction}>
                  <input type="hidden" name="cardId" value={card.id} />
                  <input type="hidden" name="conditionId" value={condition.id} />
                  <button
                    type="submit"
                    className="inline-flex h-7 items-center justify-center rounded-md border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition-colors cursor-pointer"
                  >
                    {condition.enabled ? "turn off" : "turn on"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* All-Spend Conditional Rates */}
      {rewards.baseRateOverrides?.length ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">All-spend conditional rates</h2>
          <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
            {rewards.baseRateOverrides.map((rate) => {
              const condition = rewards.conditions?.find((candidate) => candidate.id === rate.requiresConditionId);
              return (
                <li key={rate.id} className="flex items-center justify-between px-4 py-3.5 text-sm">
                  <div>
                    <span className="font-medium text-foreground">{rate.label}</span>{" "}
                    <span className="font-bold text-foreground">{rate.multiplier}x</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      - {condition?.enabled ? "active" : "off"}
                    </span>
                    {rate.capMinor ? (
                      <span className="text-xs text-muted-foreground ml-2">
                        - {formatMinorUnits(rate.capMinor, "CAD")} {rate.capWindow?.toLowerCase() ?? "monthly"} spend cap
                      </span>
                    ) : null}
                  </div>
                  <Badge variant={condition?.enabled ? "success" : "muted"} className="text-[10px]">
                    {condition?.enabled ? "Active" : "Condition off"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Recurring Credits & Benefits */}
      {rewards.credits.length > 0 ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">Recurring credits &amp; benefits</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Mark a credit only after you use it in this month or year, so the fee verdict reflects real value.
          </p>
          <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
            {rewards.credits.map((credit) => {
              const key = periodKeyFor(credit.period, today);
              const done = redeemed.some((r) => r.creditId === credit.id && r.periodKey === key);
              return (
                <li
                  key={credit.id}
                  className="flex flex-col gap-3 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <span className="font-medium text-foreground">{credit.label}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatMinorUnits(credit.valueMinor, "CAD")}/{credit.period.toLowerCase()})
                    </span>
                  </div>
                  <form action={toggleCreditAction}>
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="creditId" value={credit.id} />
                    <button
                      type="submit"
                      className="inline-flex h-7 items-center justify-center rounded-md border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition-colors cursor-pointer"
                    >
                      {done ? "redeemed - undo" : "mark redeemed"}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Merchant Bonuses */}
      {rewards.merchantRates?.length ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">Merchant-specific bonuses</h2>
          <p className="mt-1 text-xs text-muted-foreground">The picker will surface these merchants when you search for them.</p>
          <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
            {rewards.merchantRates.map((rate) => {
              const condition = rate.requiresConditionId
                ? rewards.conditions?.find((candidate) => candidate.id === rate.requiresConditionId)
                : undefined;
              return (
                <li key={rate.id} className="flex items-center justify-between px-4 py-3.5 text-sm">
                  <div>
                    <span className="font-medium text-foreground">{rate.merchant}</span>{" "}
                    <span className="font-bold text-foreground">{rate.multiplier}x</span>
                    {condition ? (
                      <span className="text-xs text-muted-foreground ml-2">
                        - {condition.label}: {condition.enabled ? "active" : "off"}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Spending Caps */}
      {capEntries.length > 0 ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">Caps</h2>
          <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
            {capEntries.map(({ id: capId, cap }) => {
              const key = periodKeyFor(cap.capWindow, today);
              const used = usage
                .filter((u) => cap.categories.includes(u.category) && u.periodKey === key)
                .reduce((sum, u) => sum + u.usedMinor, 0);
              const pct = Math.min(100, Math.round((used / cap.capMinor) * 100));
              return (
                <li key={capId} className="space-y-3 p-4 text-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <span className="font-medium text-foreground">
                      {cap.label} ({cap.capWindow.toLowerCase()})
                      {cap.allSpend
                        ? " - all spend"
                        : cap.categories.length > 1
                          ? ` - ${cap.categories.map((category) => CATEGORY_LABELS[category]).join(", ")}`
                          : ""}
                    </span>
                    <span className="tabular-nums font-semibold text-xs text-foreground">
                      {formatMinorUnits(used, "CAD")} / {formatMinorUnits(cap.capMinor, "CAD")} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-foreground transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <form action={addCapUsageAction} className="flex flex-wrap items-center gap-2 pt-1">
                    <input type="hidden" name="cardId" value={card.id} />
                    {cap.categories.length === 1 ? (
                      <input type="hidden" name="category" value={cap.categories[0]} />
                    ) : (
                      <select
                        name="category"
                        aria-label={`Category for ${cap.label}`}
                        className={`${inputStyle} w-auto`}
                      >
                        {cap.categories.map((category) => (
                          <option key={category} value={category}>
                            {CATEGORY_LABELS[category]}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      name="amount"
                      placeholder="Add spend ($)"
                      className={`${inputStyle} w-36`}
                    />
                    <button
                      type="submit"
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition-colors cursor-pointer"
                    >
                      add
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Rewards Earned This Year */}
      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-base font-semibold tracking-tight">Rewards earned this year (estimate)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter an estimate of cash back or points value earned to date.
        </p>
        <form action={setRewardsEstimateAction} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="cardId" value={card.id} />
          <input
            name="rewardsEstimate"
            aria-label="Rewards earned this year in dollars"
            defaultValue={minorToDollarInput(card.state?.rewardsEstimateMinor ?? 0)}
            className={`${inputStyle} w-40`}
          />
          <button
            type="submit"
            className="inline-flex h-8 items-center justify-center rounded-lg bg-foreground px-3.5 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            Save ($)
          </button>
        </form>
      </section>

      {/* Delete Card */}
      <div className="border-t border-border/60 pt-6">
        <form action={deleteCardAction}>
          <input type="hidden" name="cardId" value={card.id} />
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-xs font-semibold text-destructive shadow-2xs hover:bg-destructive/15 transition-colors cursor-pointer"
          >
            <Trash2 className="size-3.5" />
            <span>Delete card</span>
          </button>
        </form>
      </div>
    </main>
  );
}
