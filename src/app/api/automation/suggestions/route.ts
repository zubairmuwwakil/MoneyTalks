import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";
import { scheduleBillDueSoon, scheduleReturnDeadlineSoon, scheduleReturnDelivered, scheduleSubscriptionRenewalSoon } from "@/lib/domain/notifications/eventNotificationScheduler";
import { refreshShipmentTimeline, syncRefundExpectation } from "@/lib/domain/shipping/tracking";
import { canTransition, type ReturnStatus } from "@/engine/returns/transitions";
import type { Prisma } from "@prisma/client";
import { normalizeCurrencyCode } from "@/lib/utils/currency";

export const runtime = "nodejs";

function rankedActionsForSubscription() {
  return [
    { id: "KEEP", label: "Keep" },
    { id: "CANCEL", label: "Cancel" },
    { id: "SNOOZE", label: "Snooze" },
    { id: "DOWNGRADE", label: "Downgrade" },
    { id: "SWITCH_ANNUAL", label: "Switch annual" },
  ];
}

function isoDateOnlyToUTC(dateOnly: string) {
  // expects YYYY-MM-DD
  return new Date(dateOnly + "T00:00:00.000Z");
}

function addDaysUTC(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function toCents(n: unknown) {
  if (typeof n === "number" && Number.isFinite(n)) return Math.max(0, Math.floor(n));
  return null;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const rows = await prisma.automationSuggestion.findMany({
    where: { userId, status: "NEW" },
    orderBy: { detectedDate: "desc" },
    take: 200,
  });

  return NextResponse.json({ suggestions: rows });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { id, action, draft, intent } = body as {
    id?: string;
    action?: "CONFIRM" | "IGNORE";
    draft?: Record<string, unknown>;
    intent?: "ACTIONS";
  };

  if (intent === "ACTIONS") {
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const s = await prisma.automationSuggestion.findFirst({ where: { id, userId } });
    if (!s) return new NextResponse("Not found", { status: 404 });

    if (s.type === "SUBSCRIPTION") {
      return NextResponse.json({ actions: rankedActionsForSubscription() });
    }

    return NextResponse.json({ actions: [] });
  }

  if (!id || !action) return NextResponse.json({ error: "Missing id/action" }, { status: 400 });

  const s = await prisma.automationSuggestion.findFirst({ where: { id, userId } });
  if (!s) return new NextResponse("Not found", { status: 404 });

  // Idempotency
  if (s.status !== "NEW") return NextResponse.json({ ok: true, alreadyHandled: true });

  if (action === "IGNORE") {
    await prisma.automationSuggestion.update({
      where: { id },
      data: { status: "IGNORED" },
    });
    return NextResponse.json({ ok: true });
  }

  // CONFIRM: merge any edits from UI into stored draft
  const storedDraft = (s.draft as Record<string, unknown> | null) ?? {};
  const mergedDraft = { ...storedDraft, ...(draft ?? {}) };

  const typeRaw = (mergedDraft.type ?? s.type) as string;
  const type = (typeRaw === "SUBSCRIPTION" || typeRaw === "BILL" ? typeRaw : "RETURN") as
    | "RETURN"
    | "SUBSCRIPTION"
    | "BILL";
  const merchant = (mergedDraft.merchant ?? s.merchant) as string;
  const currencyInput = Object.prototype.hasOwnProperty.call(mergedDraft, "currency")
    ? mergedDraft.currency
    : s.currency;
  const currency = typeof currencyInput === "string"
    ? normalizeCurrencyCode(currencyInput)
    : null;

  const amountCents =
    toCents(mergedDraft.amountCents) ??
    (typeof s.amountCents === "number" ? s.amountCents : null);

  // --- Create real records based on suggestion type ---
  if (type === "RETURN") {
    const purchaseDateStr = String(mergedDraft.purchaseDate ?? "").slice(0, 10);
    const windowDays = Number.isFinite(Number(mergedDraft.returnWindowDays))
      ? Math.max(1, Number(mergedDraft.returnWindowDays))
      : 30;
    const carrier =
      typeof mergedDraft.carrier === "string" && mergedDraft.carrier.trim().length > 0 ? mergedDraft.carrier.trim() : null;
    const trackingNumber =
      typeof mergedDraft.trackingNumber === "string" && mergedDraft.trackingNumber.trim().length > 0
        ? mergedDraft.trackingNumber.trim()
        : null;
    const refundSlaDays = Number.isFinite(Number(mergedDraft.refundSlaDays))
      ? Math.max(1, Number(mergedDraft.refundSlaDays))
      : 14;
    const refundTypeRaw = typeof mergedDraft.refundType === "string" ? mergedDraft.refundType.trim().toUpperCase() : null;
    const allowedRefundTypes = new Set(["ORIGINAL", "STORE_CREDIT", "PARTIAL"]);
    const refundType = refundTypeRaw && allowedRefundTypes.has(refundTypeRaw) ? refundTypeRaw : refundTypeRaw ?? null;

    if (!purchaseDateStr) {
      return NextResponse.json({ error: "Return requires draft.purchaseDate (YYYY-MM-DD)" }, { status: 400 });
    }

    const purchaseDate = isoDateOnlyToUTC(purchaseDateStr);

    let returnBy: Date;
    const returnByStr = String(mergedDraft.returnBy ?? "").slice(0, 10);
    if (returnByStr) returnBy = isoDateOnlyToUTC(returnByStr);
    else returnBy = addDaysUTC(purchaseDate, windowDays);

    let deliveredAt: Date | null = null;
    const deliveredRaw = typeof mergedDraft.deliveredAt === "string" ? mergedDraft.deliveredAt : null;
    if (deliveredRaw) {
      const delivered = new Date(deliveredRaw);
      if (Number.isNaN(delivered.getTime())) return NextResponse.json({ error: "deliveredAt invalid" }, { status: 400 });
      deliveredAt = delivered;
    }

    let refundExpectedAt: Date | null = null;
    const refundExpectedRaw = typeof mergedDraft.refundExpectedAt === "string" ? mergedDraft.refundExpectedAt : null;
    if (refundExpectedRaw) {
      const exp = new Date(refundExpectedRaw);
      if (Number.isNaN(exp.getTime())) return NextResponse.json({ error: "refundExpectedAt invalid" }, { status: 400 });
      refundExpectedAt = exp;
    } else if (deliveredAt) {
      refundExpectedAt = addDaysUTC(deliveredAt, refundSlaDays);
    }

    const initialStatus: ReturnStatus = deliveredAt ? "DELIVERED" : trackingNumber ? "PACKED" : "NOT_STARTED";
    if (!canTransition("NOT_STARTED", initialStatus)) {
      return NextResponse.json({ error: `Cannot initialize return at ${initialStatus}` }, { status: 400 });
    }

    const createdReturn = await prisma.returnItem.create({
      data: {
        userId,
        store: merchant,
        itemNote: typeof mergedDraft.itemNote === "string" ? mergedDraft.itemNote : null,
        amountCents,
        currency,
        purchaseDate,
        returnWindowDays: windowDays,
        returnBy,
        status: initialStatus,
        dropoffDate: null,
        refundedDate: null,
        trackingNumber,
        carrier,
        deliveredAt,
        refundExpectedAt,
        refundSlaDays,
        refundType,
        refundAmountCents: null,
      },
    });

    await scheduleReturnDeadlineSoon({
      userId,
      returnId: createdReturn.id,
      store: createdReturn.store,
      itemNote: createdReturn.itemNote,
      returnBy: createdReturn.returnBy,
      amountCents: createdReturn.amountCents,
      currency: createdReturn.currency,
      status: createdReturn.status,
    });

    if (trackingNumber) {
      await refreshShipmentTimeline({ userId, returnId: createdReturn.id });
    }

    if (deliveredAt) {
      await scheduleReturnDelivered({
        userId,
        returnId: createdReturn.id,
        store: createdReturn.store,
        deliveredAt,
      });
    }

    if (refundExpectedAt !== null) {
      await syncRefundExpectation({
        userId,
        returnId: createdReturn.id,
        expectedAt: refundExpectedAt,
        refundType: refundType ?? null,
      });
    }
  }

  if (type === "SUBSCRIPTION") {
    if (!currency) {
      return NextResponse.json({ error: "Choose a currency before creating a subscription." }, { status: 400 });
    }
    const renewalDateStr = String(mergedDraft.renewalDate ?? "").slice(0, 10);
    if (!renewalDateStr) {
      return NextResponse.json({ error: "Subscription requires draft.renewalDate (YYYY-MM-DD)" }, { status: 400 });
    }

    const renewalDate = isoDateOnlyToUTC(renewalDateStr);
    const cadenceRaw = String(mergedDraft.cadence ?? "").toUpperCase();
    if (cadenceRaw !== "MONTHLY" && cadenceRaw !== "YEARLY" && cadenceRaw !== "CUSTOM") {
      return NextResponse.json(
        { error: "Subscription requires draft.cadence (MONTHLY, YEARLY, or CUSTOM)" },
        { status: 400 },
      );
    }
    const cadence = cadenceRaw;

    const trialEndAtRaw = typeof mergedDraft.trialEndAt === "string" ? mergedDraft.trialEndAt : null;
    let trialEndAt: Date | null = null;
    if (trialEndAtRaw) {
      const te = new Date(trialEndAtRaw);
      if (Number.isNaN(te.getTime())) return NextResponse.json({ error: "trialEndAt invalid" }, { status: 400 });
      trialEndAt = te;
    }

    const createdSub = await prisma.subscription.create({
      data: {
        userId,
        name: merchant,
        amountCents: amountCents ?? 0,
        currency,
        renewalDate,
        cadence,
        status: "ACTIVE",
        trialEndAt,
        cancelUrl: typeof mergedDraft.cancelUrl === "string" ? mergedDraft.cancelUrl : null,
        cancelInstructions: typeof mergedDraft.cancelInstructions === "string" ? mergedDraft.cancelInstructions : null,
        merchantCanonicalId: typeof mergedDraft.merchantCanonicalId === "string" ? mergedDraft.merchantCanonicalId : null,
      },
    });

    await scheduleSubscriptionRenewalSoon({
      userId,
      subscriptionId: createdSub.id,
      name: createdSub.name,
      renewalDate: createdSub.renewalDate,
      amountCents: createdSub.amountCents,
      currency: createdSub.currency,
    });
  }

  if (type === "BILL") {
    if (!currency) {
      return NextResponse.json({ error: "Choose a currency before creating a bill." }, { status: 400 });
    }
    const dueDayInput = Number(mergedDraft.dueDayOfMonth);
    if (!Number.isInteger(dueDayInput) || dueDayInput < 1 || dueDayInput > 28) {
      return NextResponse.json(
        { error: "Bill requires draft.dueDayOfMonth (an integer from 1 to 28)" },
        { status: 400 },
      );
    }
    const dueDayOfMonth = dueDayInput;

    const currentMonth = new Date().toISOString().slice(0, 10);

    const createdBill = await prisma.bill.create({
      data: {
        userId,
        name: merchant,
        category: "other",
        currency,
        autopay: Boolean(mergedDraft.autopay ?? false),
        cadence: { type: "MONTHLY", dayOfMonth: dueDayOfMonth },
        schedule: [{ from: currentMonth, amountMinor: amountCents ?? 0 }],
      },
    });

    // Notify about the newly created bill
    await scheduleBillDueSoon({
      userId,
      billId: createdBill.id,
      name: createdBill.name,
      dueDayOfMonth: dueDayOfMonth,
      amountCents: amountCents ?? 0,
      currency: createdBill.currency,
    });
  }

  // Mark suggestion confirmed (store merged draft edits too)
  await prisma.automationSuggestion.update({
    where: { id },
    data: {
      status: "CONFIRMED",
      merchant,
      amountCents,
      currency,
      draft: mergedDraft as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true });
}
