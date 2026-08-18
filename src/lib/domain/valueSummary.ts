import { prisma } from "@/lib/prisma";
import { addDays } from "date-fns";
import { ValueEventType } from "@prisma/client";
import { convertMinor, type FxRateInput } from "@/engine/fx";
import { Currency } from "@/engine/money";

export interface ValueSummary {
  saved: {
    totalCents: number;
    confirmedCents: number;
    estimatedCents: number;
    currency: string;
    events: ValueEventDTO[];
  };
  atRisk: {
    totalCents: number;
    currency: string;
    horizonDays: number;
    renewals: AtRiskItem[];
    returnDeadlines: AtRiskItem[];
    overdueRefunds: AtRiskItem[];
  };
  recovered: {
    totalCents: number;
    currency: string;
    events: ValueEventDTO[];
  };
}

export interface ValueEventDTO {
  id: string;
  label: string;
  type: string;
  amountCents: number;
  currency: string;
  occurredAt: string;
  isEstimated: boolean;
  sourceId: string | null;
}

export interface AtRiskItem {
  id: string;
  label: string;
  kind: "RENEWAL" | "RETURN_DEADLINE" | "REFUND_OVERDUE";
  dueDate: string;
  amountCents: number | null;
  currency: string;
  meta: Record<string, string | null>;
}

function sumCents(arr: number[]): number {
  return arr.reduce((acc, v) => acc + v, 0);
}

export function convertMinorIfKnown(
  amountCents: number | null,
  currency: string | null,
  displayCurrency: Currency,
  rates: FxRateInput[],
): number | null {
  if (amountCents == null || !currency) return null;
  try {
    return convertMinor(amountCents, currency as Currency, displayCurrency, rates);
  } catch {
    // Missing FX is missing information, not permission to relabel the raw
    // number as the display currency.
    return null;
  }
}

export async function computeValueSummary(
  userId: string,
  opts?: { horizonDays?: number; displayCurrency?: string }
): Promise<ValueSummary> {
  const horizonDays = opts?.horizonDays ?? 7;
  const displayCurrency = (opts?.displayCurrency ?? "CAD").toUpperCase() as Currency;
  const now = new Date();
  const horizonDate = addDays(now, horizonDays);

  const [subscriptions, returns, valueEvents, fxRatesRaw] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId, status: "ACTIVE" },
      select: { id: true, name: true, amountCents: true, currency: true, renewalDate: true, status: true },
    }),
    prisma.returnItem.findMany({
      where: { userId },
      select: {
        id: true,
        store: true,
        itemNote: true,
        amountCents: true,
        refundAmountCents: true,
        currency: true,
        returnBy: true,
        refundExpectedAt: true,
        deliveredAt: true,
        refundSlaDays: true,
        status: true,
        refundedDate: true,
      },
    }),
    prisma.valueEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }),
    prisma.fxRate.findMany({
      where: { userId, asOf: { lte: now } },
      orderBy: [{ quote: "asc" }, { asOf: "desc" }],
    }),
  ]);

  const rates: FxRateInput[] = fxRatesRaw.map((r) => ({
    base: r.base as Currency,
    quote: r.quote as Currency,
    rate: Number(r.rate),
    asOf: r.asOf.toISOString(),
  }));

  const safeConvert = (amountCents: number | null, currency: string | null) =>
    convertMinorIfKnown(amountCents, currency, displayCurrency, rates);

  const savedEvents: ValueEventDTO[] = valueEvents
    .filter(ev => ev.type !== ValueEventType.REFUND_RECEIVED)
    .flatMap(ev => {
      const converted = safeConvert(ev.amountCents, ev.currency);
      return converted == null
        ? []
        : [{
            id: ev.id,
            label: ev.sourceId ? `${ev.type.replace("_", " ")}` : ev.type,
            type: ev.type,
            amountCents: converted,
            currency: displayCurrency,
            occurredAt: ev.occurredAt.toISOString(),
            isEstimated: ev.isEstimated,
            sourceId: ev.sourceId,
          }];
    });

  const savedConfirmed = sumCents(savedEvents.filter(ev => !ev.isEstimated).map(ev => ev.amountCents));
  const savedEstimated = sumCents(savedEvents.filter(ev => ev.isEstimated).map(ev => ev.amountCents));

  const recoveredMap = new Map<string, ValueEventDTO>();
  valueEvents
    .filter(ev => ev.type === ValueEventType.REFUND_RECEIVED)
    .forEach(ev => {
      const converted = safeConvert(ev.amountCents, ev.currency);
      if (converted == null) return;
      const key = ev.sourceId ? `ve-${ev.sourceId}` : ev.id;
      recoveredMap.set(key, {
        id: ev.id,
        label: "Refund received",
        type: ev.type,
        amountCents: converted,
        currency: displayCurrency,
        occurredAt: ev.occurredAt.toISOString(),
        isEstimated: ev.isEstimated,
        sourceId: ev.sourceId,
      });
    });

  returns
    .filter(r => r.refundedDate)
    .forEach(r => {
      const key = `return-${r.id}`;
      if (recoveredMap.has(key)) return;
      const converted = safeConvert(r.refundAmountCents ?? r.amountCents ?? 0, r.currency);
      if (converted == null) return;
      recoveredMap.set(key, {
        id: key,
        label: r.store,
        type: ValueEventType.REFUND_RECEIVED,
        amountCents: converted,
        currency: displayCurrency,
        occurredAt: r.refundedDate!.toISOString(),
        isEstimated: false,
        sourceId: r.id,
      });
    });

  const recoveredEvents = Array.from(recoveredMap.values()).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const renewalRisks: AtRiskItem[] = subscriptions
    .filter(s => s.renewalDate >= now && s.renewalDate <= horizonDate)
    .map(s => ({
      id: s.id,
      label: s.name,
      kind: "RENEWAL" as const,
      dueDate: s.renewalDate.toISOString(),
      amountCents: safeConvert(s.amountCents, s.currency),
      currency: displayCurrency,
      meta: { status: s.status },
    }));

  const returnDeadlineRisks: AtRiskItem[] = returns
    .filter(r => r.status !== "REFUNDED" && r.returnBy >= now && r.returnBy <= horizonDate)
    .map(r => ({
      id: r.id,
      label: r.itemNote ? `${r.store} — ${r.itemNote}` : r.store,
      kind: "RETURN_DEADLINE" as const,
      dueDate: r.returnBy.toISOString(),
      amountCents: safeConvert(r.amountCents ?? r.refundAmountCents ?? null, r.currency),
      currency: displayCurrency,
      meta: { status: r.status, store: r.store },
    }));

  const overdueRefunds: AtRiskItem[] = returns
    .filter(r => r.status !== "REFUNDED")
    .map(r => {
      const expected = r.refundExpectedAt ?? (r.deliveredAt ? addDays(r.deliveredAt, r.refundSlaDays ?? 14) : null);
      return { record: r, expected } as const;
    })
    .filter(({ expected }) => Boolean(expected && expected < now))
    .map(({ record, expected }) => ({
      id: `${record.id}-overdue`,
      label: record.itemNote ? `${record.store} — refund` : `${record.store} refund`,
      kind: "REFUND_OVERDUE" as const,
      dueDate: expected!.toISOString(),
      amountCents: safeConvert(record.refundAmountCents ?? record.amountCents ?? null, record.currency),
      currency: displayCurrency,
      meta: { status: record.status, store: record.store },
    }));

  const atRiskTotal = sumCents([
    ...renewalRisks.map(r => r.amountCents ?? 0),
    ...returnDeadlineRisks.map(r => r.amountCents ?? 0),
    ...overdueRefunds.map(r => r.amountCents ?? 0),
  ]);

  const summary: ValueSummary = {
    saved: {
      totalCents: savedConfirmed + savedEstimated,
      confirmedCents: savedConfirmed,
      estimatedCents: savedEstimated,
      currency: displayCurrency,
      events: savedEvents.slice(0, 25),
    },
    atRisk: {
      totalCents: atRiskTotal,
      currency: displayCurrency,
      horizonDays,
      renewals: renewalRisks.slice(0, 25),
      returnDeadlines: returnDeadlineRisks.slice(0, 25),
      overdueRefunds: overdueRefunds.slice(0, 25),
    },
    recovered: {
      totalCents: sumCents(recoveredEvents.map(ev => ev.amountCents)),
      currency: displayCurrency,
      events: recoveredEvents.slice(0, 25),
    },
  };

  return summary;
}
