import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Edit2, Trash2 } from "lucide-react";
import { deleteCard, setRewardsEstimate, toggleCredit } from "@/app/cards/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeeCycleNote } from "@/components/fee-cycle-note";
import {
  catalogueCard,
  catalogueCredits,
  catalogueCreditsRealizedMinor,
  effectiveAnnualFeeMinor,
  feeWaiverNote,
  type RedeemedCredit,
} from "@/lib/cards/catalogueCard";
import { currentFeeCycle, type FeeScheduleCard } from "@/lib/cards/feeSchedule";
import type { CardDef } from "@/lib/cards/types";
import { formatMinorUnits, minorToDollarInput, type Currency } from "@/engine/money";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { CardImage } from "@/components/cards/card-image";

const inputStyle =
  "flex h-8 rounded-lg border border-input bg-background px-2.5 py-1 text-xs shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

function cardErrorPath(cardId: string, form: string, message: string) {
  return `/cards/${cardId}?errorForm=${form}&error=${encodeURIComponent(message)}`;
}

export default async function CardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; errorForm?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { error, errorForm } = (await searchParams) ?? {};
  const card = await prisma.creditCard.findFirst({ where: { id, userId }, include: { state: true } });
  if (!card) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const redeemed = (card.state?.creditsRedeemed as unknown as RedeemedCredit[]) ?? [];

  // Everything rate-shaped is the catalogue's. A null product means this row
  // has not been linked to a catalogue card yet — shown as an explicit prompt
  // rather than filled in with a guess, because a wrong link would rescore the
  // owner's spend against a card they do not hold.
  const product = catalogueCard(card.contractCardId);
  const credits = catalogueCredits(card.contractCardId);
  const waiver = feeWaiverNote(card.contractCardId);

  const def: FeeScheduleCard = {
    id: card.id,
    nickname: card.nickname,
    network: card.network as CardDef["network"],
    annualFeeMinor: card.annualFeeMinor,
    feeRebateMinor: card.feeRebateMinor,
    contractCardId: card.contractCardId,
    feeMonthDay: card.feeMonthDay,
    feeCancelGraceDays: card.feeCancelGraceDays,
  };
  const effectiveFee = effectiveAnnualFeeMinor(card.annualFeeMinor, card.feeRebateMinor);
  const now = new Date();
  const feeCycle = currentFeeCycle(def, now);
  const realizedMinor =
    catalogueCreditsRealizedMinor(credits, redeemed, today) + (card.state?.rewardsEstimateMinor ?? 0);
  const netMinor = realizedMinor - effectiveFee;

  async function toggleCreditAction(formData: FormData) {
    "use server";
    const result = await toggleCredit(formData);
    if (!result.ok) redirect(cardErrorPath(id, "credit", result.error));
    redirect(`/cards/${id}`);
  }

  async function setRewardsEstimateAction(formData: FormData) {
    "use server";
    const result = await setRewardsEstimate(formData);
    if (!result.ok) redirect(cardErrorPath(id, "estimate", result.error));
    redirect(`/cards/${id}`);
  }

  async function deleteCardAction(formData: FormData) {
    "use server";
    const result = await deleteCard(formData);
    if (!result.ok) redirect(cardErrorPath(id, "delete", result.error));
    redirect("/cards/manage");
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

        <header className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-muted/20 p-5 sm:p-6 shadow-2xs">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 sm:gap-6">
            <div className="shrink-0 w-full max-w-[280px] sm:max-w-[320px]">
              <CardImage
                contractCardId={card.contractCardId}
                nickname={card.nickname}
                issuer={card.issuer}
                network={card.network}
                lastFour={card.lastFour}
                size="hero"
                priority
              />
            </div>

            <div className="flex-1 min-w-0 w-full space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{card.nickname}</h1>
                  <Badge variant="outline" className="text-xs font-mono font-bold">
                    {card.network}
                  </Badge>
                  {card.lastFour ? (
                    <span className="text-xs font-mono text-muted-foreground bg-muted/80 px-2 py-0.5 rounded">
                      •••• {card.lastFour}
                    </span>
                  ) : null}
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/cards/${card.id}/edit`} className="flex items-center gap-1.5">
                    <Edit2 className="size-3" />
                    <span>Edit card</span>
                  </Link>
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                {card.issuer} {product?.kind ? `· ${product.kind} card` : ""} · effective fee{" "}
                <span className="font-semibold text-foreground">{formatMinorUnits(effectiveFee, "CAD")}/yr</span>
                {effectiveFee !== card.annualFeeMinor
                  ? ` (published ${formatMinorUnits(card.annualFeeMinor, "CAD")})`
                  : ""}
              </p>

              {feeCycle ? (
                <FeeCycleNote cycle={feeCycle} today={now} currency={card.currency as Currency} className="mt-1 block" />
              ) : effectiveFee > 0 && !card.feeMonthDay ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No renewal date set —{" "}
                  <Link href={`/cards/${card.id}/edit`} className="underline underline-offset-2">
                    add one
                  </Link>{" "}
                  to see how long you have to cancel.
                </p>
              ) : null}
            </div>
          </div>
        </header>
      </div>

      {/* An unlinked card still works — it simply has no rates until it is
          matched to a catalogue product. Saying so beats inventing one. */}
      {product ? null : (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="text-base font-semibold tracking-tight">Not linked to a card yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This card has no rates, caps or credits because we don&apos;t know which product it is.
            Link it and it will score identically here and in PickMe.
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link href={`/cards/${card.id}/edit`}>Link this card</Link>
          </Button>
        </section>
      )}

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
                <span className="font-semibold text-foreground tabular-nums">
                  {formatMinorUnits(netMinor, "CAD")}
                </span>
              </p>
            </div>
            {product ? (
              <div className="space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground sm:border-t-0 sm:pt-0 sm:text-right">
                <p>
                  Catalogue card:{" "}
                  <span className="font-semibold text-foreground">{product.officialName}</span>
                </p>
                <p>
                  Rewards:{" "}
                  <span className="font-semibold text-foreground">
                    {product.program.unit === "cashback" ? "cash back" : product.program.programId}
                  </span>
                </p>
                <p>
                  Verified <span className="font-semibold text-foreground">{product.lastVerifiedAt}</span>
                </p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* How this card earns — read from the catalogue, never editable here.
          Rules PickMe scores with are the rules shown. */}
      {product ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">How this card earns</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            From the shared card catalogue, verified against the issuer. These are the same rules
            PickMe scores with at checkout, so they are not editable here.
          </p>
          <ul className="mt-4 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/80 bg-background">
            {product.earnRules.map((rule) => {
              const cap = rule.capId ? product.caps.find((c) => c.capId === rule.capId) : undefined;
              const categories = rule.predicate.categories ?? [];
              const earn =
                rule.earn.type === "points"
                  ? `${rule.earn.pointsPerCad}x points`
                  : rule.earn.type === "cashback"
                    ? `${(rule.earn.rate * 100).toFixed(2).replace(/\.?0+$/, "")}% back`
                    : "cents per litre";
              return (
                <li key={rule.ruleId} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{earn}</span>
                    <span className="text-xs text-muted-foreground">
                      {categories.length > 0 ? categories.join(", ") : "all other spend"}
                    </span>
                  </div>
                  {cap ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Capped at ${cap.limit.toLocaleString()} per{" "}
                      {cap.period === "calendarMonth"
                        ? "month"
                        : cap.period === "calendarYear"
                          ? "year"
                          : "account year"}
                    </p>
                  ) : null}
                  {rule.ownerConditions?.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Requires: {rule.ownerConditions.join(", ")} — answered in PickMe&apos;s wallet setup.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {waiver ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Fee waiver:</span> {waiver} Record what
              your own package actually rebates on the{" "}
              <Link href={`/cards/${card.id}/edit`} className="underline underline-offset-2">
                edit page
              </Link>{" "}
              — we never assume a figure.
            </p>
          ) : null}
        </section>
      ) : null}

      {credits.length > 0 ? (
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <h2 className="text-base font-semibold tracking-tight">Recurring credits</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Mark a credit only after you use it in this month or year, so the fee verdict reflects
            real value.
          </p>
          <ul className="mt-4 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/80 bg-background">
            {credits.map((credit) => {
              const key = credit.period === "calendarMonth" ? today.slice(0, 7) : today.slice(0, 4);
              const done = redeemed.some((r) => r.creditId === credit.creditId && r.periodKey === key);
              return (
                <li
                  key={credit.creditId}
                  className="flex flex-col gap-3 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <span className="font-medium text-foreground">{credit.label}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatMinorUnits(Math.round(credit.valueCad * 100), "CAD")}/
                      {credit.period === "calendarMonth" ? "month" : "year"})
                    </span>
                  </div>
                  <form action={toggleCreditAction}>
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="creditId" value={credit.creditId} />
                    <button
                      type="submit"
                      className="inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-border/80 bg-muted/60 px-3 text-xs font-semibold text-foreground shadow-2xs transition-colors hover:bg-muted"
                    >
                      {done ? "redeemed - undo" : "mark redeemed"}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          {errorForm === "credit" && error ? (
            <p className="mt-2 text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

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
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-foreground px-3.5 text-xs font-semibold text-background shadow-xs transition-colors hover:bg-foreground/90"
          >
            Save ($)
          </button>
        </form>
        {errorForm === "estimate" && error ? (
          <p className="mt-3 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <div className="border-t border-border/60 pt-6">
        <form action={deleteCardAction}>
          <input type="hidden" name="cardId" value={card.id} />
          <button
            type="submit"
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-xs font-semibold text-destructive shadow-2xs transition-colors hover:bg-destructive/15"
          >
            <Trash2 className="size-3.5" />
            <span>Delete card</span>
          </button>
        </form>
        {errorForm === "delete" && error ? (
          <p className="mt-3 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
