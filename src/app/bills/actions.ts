"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { toReporting, type Catalogue, type OwnerState } from "@/engine/cards-twin";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { FxRateInput } from "@/engine/fx";
import { parseDollarsToMinor, type Currency } from "@/engine/money";
import { amountOn, type Cadence, type ScheduleEntry } from "@/engine/recurrence";
import { scoreBillRoutes } from "@/engine/billRouteScorer";
import { billSpendCategoryOptions, recommendCardForBill } from "@/lib/domain/bills/cardForBill";
import { buildBillRouteWallet } from "@/lib/domain/bills/billRouteWallet";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { protectBillAccountNumber, revealBillAccountNumber } from "@/lib/domain/bills/accountNumber";
import { lookupCorporateCreditor } from "@/lib/services/paymentsCanada";
import { billFormInput, billPayeeDetailsInput, cadenceInput, scheduleEntryInput } from "@/lib/validation/bills";
import { resolveBillTaxonomy } from "@/lib/taxonomy/billTaxonomy";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Invalid input" };
}

/** Prisma's Json columns are validated by zod on the way in, not by the type system. */
function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

// Same module-level singleton + cast precedent as src/app/bills/page.tsx and
// src/app/bills/new/page.tsx — the catalogue JSON never changes at runtime.
const catalogue = cardCatalogue as unknown as Catalogue;
const spendCategoryOptions = billSpendCategoryOptions(catalogue);

async function ownedBill(userId: string, billId: string) {
  const bill = await prisma.bill.findFirst({ where: { id: billId, userId } });
  if (!bill) throw new Error("Bill not found");
  return bill;
}

async function resolvePaymentSource(userId: string, value: string | undefined) {
  if (!value) return {};
  const separator = value.indexOf(":");
  const kind = separator === -1 ? "" : value.slice(0, separator);
  const id = separator === -1 ? "" : value.slice(separator + 1);
  if (!id) throw new Error("Choose a valid payment source.");

  if (kind === "card") {
    const card = await prisma.creditCard.findFirst({ where: { id, userId }, select: { id: true } });
    if (!card) throw new Error("That card is not in your wallet.");
    return { paymentCardId: card.id, sourceAccountId: null };
  }

  if (kind === "account") {
    const account = await prisma.financialAccount.findFirst({
      where: { id, userId, type: { in: ["CHEQUING", "CASH"] } },
      select: { id: true },
    });
    if (!account) throw new Error("That bank account is not available as a payment source.");
    return { paymentCardId: null, sourceAccountId: account.id };
  }

  throw new Error("Choose a valid payment source.");
}

async function resolveVerifiedBiller(billerKind: string, ccin: string | undefined) {
  if (billerKind !== "REGISTERED_BILLER") return null;
  if (!ccin) throw new Error("Search for and select a Payments Canada biller first.");
  const biller = await lookupCorporateCreditor(ccin);
  if (biller.status !== "ACTIVE") {
    throw new Error(`${biller.shortName} is not an active Payments Canada biller.`);
  }
  return {
    payee: biller.shortName,
    billerKind: "REGISTERED_BILLER",
    paymentsCanadaCcin: biller.ccin,
    billerVerifiedAt: new Date(),
    billerVerificationEnv: biller.environment,
  } as const;
}

async function resolveSelectedRoute(
  userId: string,
  routeId: string,
  payeeName: string,
  monthlyCad: number,
) {
  const [ownerStateRecord, storedCards] = await Promise.all([
    ensureOwnerStateRecord(prisma, userId),
    prisma.creditCard.findMany({
      where: { userId },
      select: { id: true, nickname: true, contractCardId: true },
      orderBy: { nickname: "asc" },
    }),
  ]);
  const ownerState = ownerStateRecord ? (ownerStateRecord.stateData as unknown as OwnerState) : null;
  const wallet = buildBillRouteWallet(
    catalogue,
    ownerState,
    storedCards,
    new Date().toISOString().slice(0, 10),
  );
  const route = scoreBillRoutes({ payeeName, monthlyCad, ownedCards: wallet })
    .find((candidate) => candidate.id === routeId);
  if (!route) throw new Error("That payment route is no longer available in your wallet.");

  const routeFields = {
    selectedRouteId: route.id,
    selectedRouteIntermediaryId: route.intermediary.id,
    paymentCardId: route.walletCardId,
  };
  switch (route.intermediary.type) {
    case "creditIntermediary":
      return {
        ...routeFields,
        paymentRail: "card_via_third_party",
        railFeePct: Math.round(route.intermediary.feeRate * 10_000) / 100,
      };
    case "cardDirectBillPay":
      return { ...routeFields, paymentRail: "card", railFeePct: null };
    case "fintechAccountRouting":
    case "standardEft":
      return { ...routeFields, paymentRail: "pad", railFeePct: null };
  }
}

export async function createBill(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = billFormInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const {
    cadenceJson,
    scheduleJson,
    selectedRouteId,
    paymentSource,
    accountNumber,
    paymentsCanadaCcin,
    ...core
  } = parsed.data;

  if (core.spendCategory && !spendCategoryOptions.some((o) => o.value === core.spendCategory)) {
    return { ok: false, error: `Unrecognized spend category "${core.spendCategory}".` };
  }

  // Not an upsert: silently replacing a same-named bill would discard its whole
  // schedule timeline. Editing an existing bill happens on its detail page.
  const existing = await prisma.bill.findUnique({
    where: { userId_name: { userId, name: core.name } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: `A bill named "${core.name}" already exists — open it to edit.` };
  }

  try {
    const billId = randomUUID();
    const resolvedRouteData = selectedRouteId
      ? await resolveSelectedRoute(
          userId,
          selectedRouteId,
          core.payee ?? core.name,
          scheduleJson[0].amountMinor / 100,
        )
      : {};
    const [paymentSourceData, verifiedBiller] = await Promise.all([
      resolvePaymentSource(userId, paymentSource),
      resolveVerifiedBiller(core.billerKind, paymentsCanadaCcin),
    ]);
    const selectedCardId = paymentSource?.startsWith("card:") ? paymentSource.slice("card:".length) : null;
    const routedCardId = "paymentCardId" in resolvedRouteData ? resolvedRouteData.paymentCardId : null;
    const routeData =
      !paymentSource || (selectedCardId && routedCardId === selectedCardId)
        ? resolvedRouteData
        : {};
    const protectedAccount = accountNumber
      ? protectBillAccountNumber(accountNumber, userId, billId)
      : null;
    await prisma.bill.create({
      data: {
        id: billId,
        ...core,
        ...routeData,
        ...paymentSourceData,
        ...(verifiedBiller ?? {}),
        accountNumber: null,
        accountNumberEncrypted: protectedAccount?.encrypted ?? null,
        accountNumberLast4: protectedAccount?.lastFour ?? null,
        userId,
        cadence: asJson(cadenceJson),
        schedule: asJson(scheduleJson),
      },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/bills");
  revalidatePath("/");
  return { ok: true };
}

export async function setBillRoute(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const routeId = String(formData.get("selectedRouteId") ?? "").trim();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    if (!routeId) {
      await prisma.bill.update({
        where: { id: bill.id },
        data: { selectedRouteId: null, selectedRouteIntermediaryId: null },
      });
    } else {
      const schedule = bill.schedule as unknown as ScheduleEntry[];
      const routeData = await resolveSelectedRoute(
        userId,
        routeId,
        bill.payee ?? bill.name,
        (schedule[0]?.amountMinor ?? 0) / 100,
      );
      await prisma.bill.update({ where: { id: bill.id }, data: routeData });
    }
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/**
 * Pins (or clears, on an empty submission) `Bill.spendCategory` — the
 * override seam `cardForBill.ts`'s `resolveBillSpendCategory`/
 * `buildBillPurchaseContext` already expose (`opts.override`). Validated
 * against the SAME catalogue-derived option list the create form offers
 * (`billSpendCategoryOptions`), so a hand-crafted form submission can't pin
 * a category the catalogue can't actually score.
 */
export async function setBillSpendCategory(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const raw = String(formData.get("spendCategory") ?? "").trim();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    if (raw !== "" && !spendCategoryOptions.some((o) => o.value === raw)) {
      return { ok: false, error: `Unrecognized spend category "${raw}".` };
    }
    await prisma.bill.update({ where: { id: bill.id }, data: { spendCategory: raw === "" ? null : raw } });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/**
 * Sets `Bill.paymentRail` (and its fee) — the eligibility dimension
 * `cardForBill.ts`'s `resolveBillPaymentRail` gates on, orthogonal to the
 * spend category pinned above. Editable after creation because the rail is
 * usually discovered later, the first time the biller's payment page is
 * actually opened.
 *
 * The fee is CLEARED whenever the rail isn't `card_via_third_party`: the
 * domain layer only ever reads it for that rail, so a leftover value would
 * be invisible-but-persisted state that reappears if the rail is switched
 * back — a stale number the user never re-confirmed. A third-party rail with
 * NO fee is stored as-is rather than rejected; `resolveBillPaymentRail`
 * already declines to recommend and explains what's missing, which is more
 * useful than blocking the edit.
 */
const PAYMENT_RAIL_VALUES = new Set(["unknown", "card", "pad", "card_via_third_party"]);

export async function setBillPaymentRail(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const rail = String(formData.get("paymentRail") ?? "").trim();
  const rawFee = String(formData.get("railFeePct") ?? "").trim();
  if (!PAYMENT_RAIL_VALUES.has(rail)) {
    return { ok: false, error: `Unrecognized payment rail "${rail}".` };
  }
  let railFeePct: number | null = null;
  if (rail === "card_via_third_party" && rawFee !== "") {
    const parsed = Number(rawFee);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return { ok: false, error: `"${rawFee}" is not a valid service fee percentage.` };
    }
    railFeePct = parsed;
  }
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    await prisma.bill.update({ where: { id: bill.id }, data: { paymentRail: rail, railFeePct } });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/**
 * Sets (or clears) `Bill.paymentCardId` to any of the user's OWN cards —
 * the general "let the user set paymentCardId" capability. Does not require
 * the chosen card to be linked to the catalogue (`contractCardId` non-null):
 * a user is free to record "I pay this with my debit-backed card" even
 * though that card can never be scored — `computeBillAllocation`
 * (src/lib/domain/bills/billAllocationSummary.ts) reports that honestly as
 * "unscoreable" rather than refusing the assignment outright.
 */
export async function setBillPaymentCard(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const raw = String(formData.get("paymentCardId") ?? "").trim();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    if (raw === "") {
      await prisma.bill.update({ where: { id: bill.id }, data: { paymentCardId: null } });
    } else {
      const card = await prisma.creditCard.findFirst({ where: { id: raw, userId }, select: { id: true } });
      if (!card) return { ok: false, error: "Card not found." };
      await prisma.bill.update({ where: { id: bill.id }, data: { paymentCardId: card.id } });
    }
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function setBillPaymentSource(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const billId = String(formData.get("billId") ?? "").trim();
  const paymentSource = String(formData.get("paymentSource") ?? "").trim();
  try {
    const bill = await ownedBill(userId, billId);
    const source = paymentSource
      ? await resolvePaymentSource(userId, paymentSource)
      : { paymentCardId: null, sourceAccountId: null };
    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        ...source,
        selectedRouteId: null,
        selectedRouteIntermediaryId: null,
      },
    });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/**
 * The bills-list one-click action: re-derives this bill's own recommendation
 * server-side (same inputs as the list/detail pages — see their
 * `recommendCardForBill` calls) and allocates the winning card, resolved
 * back to the caller's OWN `CreditCard` row via `contractCardId`. Refuses
 * rather than guessing when there's no recommendation to act on, or when the
 * winning catalogue card isn't actually one of the user's saved cards
 * (shouldn't happen — `recommendCardForBill` only scores owned cards — but
 * this is a second request, not the same one that computed the list page,
 * so it re-checks rather than trusting a value handed back from the client).
 */
export async function allocateRecommendedCard(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(now.getTime() + 400 * 86_400_000).toISOString().slice(0, 10);

    const [ownerStateRecord, fxRatesRaw] = await Promise.all([
      ensureOwnerStateRecord(prisma, userId),
      prisma.fxRate.findMany({ where: { userId, asOf: { lte: now } }, orderBy: [{ quote: "asc" }, { asOf: "desc" }] }),
    ]);
    const ownerState = ownerStateRecord ? (ownerStateRecord.stateData as unknown as OwnerState) : null;
    const fxRates: FxRateInput[] = fxRatesRaw.map((r) => ({
      base: r.base as Currency,
      quote: r.quote as Currency,
      rate: Number(r.rate),
      asOf: r.asOf.toISOString(),
    }));

    const def: BillDef = {
      id: bill.id,
      name: bill.name,
      category: bill.category,
      currency: bill.currency,
      autopay: bill.autopay,
      variable: bill.variable,
      cadence: bill.cadence as unknown as Cadence,
      schedule: bill.schedule as unknown as ScheduleEntry[],
    };
    const next = billOccurrences(def, today, horizon)[0] ?? null;

    const rec = recommendCardForBill(
      catalogue,
      ownerState,
      {
        category: bill.category,
        currency: bill.currency,
        variable: bill.variable,
        paymentRail: bill.paymentRail,
        railFeePct: bill.railFeePct === null ? null : Number(bill.railFeePct),
      },
      next ? { amountMinor: next.amountMinor } : null,
      fxRates,
      today,
      { override: bill.spendCategory ?? undefined },
    );
    if (rec.status !== "recommended") {
      return { ok: false, error: "No recommendation is available for this bill yet." };
    }

    // 1. Try finding a card already linked by contractCardId
    let card = await prisma.creditCard.findFirst({
      where: { userId, contractCardId: rec.winner.cardId },
      select: { id: true },
    });

    // 2. If not linked, check if user has a card with matching nickname/name and auto-link it
    if (!card) {
      const match = await prisma.creditCard.findFirst({
        where: {
          userId,
          nickname: { equals: rec.winner.cardName, mode: "insensitive" },
        },
        select: { id: true, contractCardId: true },
      });
      if (match) {
        card = match;
        if (!match.contractCardId) {
          await prisma.creditCard.update({
            where: { id: match.id },
            data: { contractCardId: rec.winner.cardId },
          });
        }
      }
    }

    // 3. If still not found, auto-provision the card from the catalogue for this user
    if (!card) {
      const catCard = catalogue.cards.find((c) => c.cardId === rec.winner.cardId);
      if (catCard) {
        try {
          const created = await prisma.creditCard.create({
            data: {
              userId,
              nickname: catCard.officialName,
              issuer: catCard.issuer,
              network: catCard.network.toUpperCase(),
              annualFeeMinor: Math.round(toReporting(catCard.fee?.annual) * 100),
              contractCardId: catCard.cardId,
            },
            select: { id: true },
          });
          card = created;
        } catch {
          const existing = await prisma.creditCard.findUnique({
            where: { userId_nickname: { userId, nickname: catCard.officialName } },
            select: { id: true, contractCardId: true },
          });
          if (existing) {
            card = existing;
            if (!existing.contractCardId) {
              await prisma.creditCard.update({
                where: { id: existing.id },
                data: { contractCardId: catCard.cardId },
              });
            }
          }
        }
      }
    }

    if (!card) return { ok: false, error: "Could not find or provision the recommended card in your wallet." };

    await prisma.bill.update({ where: { id: bill.id }, data: { paymentCardId: card.id } });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/cards");
    revalidatePath("/settings/wallet");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function deleteBill(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const bill = await ownedBill(userId, String(formData.get("id") ?? ""));
    await prisma.bill.delete({ where: { id: bill.id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/bills");
  revalidatePath("/");
  return { ok: true };
}

export async function setBillCadence(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const rawCadenceJson = formData.get("cadenceJson");
  let parsedCadence;

  if (typeof rawCadenceJson === "string" && rawCadenceJson.trim() !== "") {
    try {
      parsedCadence = cadenceInput.safeParse(JSON.parse(rawCadenceJson));
    } catch {
      return { ok: false, error: "Invalid cadence JSON format." };
    }
  } else {
    const type = String(formData.get("cadenceType") ?? formData.get("type") ?? "");
    const rawObj: Record<string, unknown> = { type };
    if (type === "MONTHLY") {
      rawObj.dayOfMonth = formData.get("dayOfMonth");
      const startsFrom = formData.get("startsFrom");
      if (startsFrom && String(startsFrom).trim() !== "") rawObj.startsFrom = startsFrom;
    } else {
      rawObj.anchor = formData.get("anchor");
    }
    parsedCadence = cadenceInput.safeParse(rawObj);
  }

  if (!parsedCadence.success) {
    return fail(parsedCadence.error.issues[0]?.message ?? "Invalid cadence parameters");
  }

  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    await prisma.bill.update({ where: { id: bill.id }, data: { cadence: asJson(parsedCadence.data) } });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/bills/forecast");
    revalidatePath("/bills/month");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function addScheduleEntry(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = scheduleEntryInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const schedule = [...(bill.schedule as unknown as ScheduleEntry[]), parsed.data];
    await prisma.bill.update({ where: { id: bill.id }, data: { schedule: asJson(schedule) } });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/bills/forecast");
    revalidatePath("/bills/month");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function removeScheduleEntry(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const index = Number(formData.get("index"));
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const schedule = (bill.schedule as unknown as ScheduleEntry[]).filter((_, i) => i !== index);
    if (schedule.length === 0) return { ok: false, error: "A bill needs at least one schedule entry" };
    await prisma.bill.update({ where: { id: bill.id }, data: { schedule: asJson(schedule) } });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/bills/forecast");
    revalidatePath("/bills/month");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function markPaid(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const dueDate = String(formData.get("dueDate") ?? "");
  const actualRaw = String(formData.get("actualAmount") ?? "").trim();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const expected = amountOn(bill.schedule as unknown as ScheduleEntry[], dueDate);
    if (expected === null) return { ok: false, error: "No scheduled amount on that date" };
    // Typed in dollars like every other money field; stored as integer cents.
    const actual = actualRaw === "" ? expected : parseDollarsToMinor(actualRaw);
    if (actual === null || !Number.isSafeInteger(actual) || actual < 0) {
      return { ok: false, error: "Actual amount must be a dollar amount, e.g. 84.20" };
    }
    await prisma.payment.upsert({
      where: { billId_dueDate: { billId: bill.id, dueDate: new Date(dueDate) } },
      update: { actualAmountMinor: actual, paidAt: new Date() },
      create: {
        billId: bill.id,
        dueDate: new Date(dueDate),
        expectedAmountMinor: expected,
        actualAmountMinor: actual,
        paidAt: new Date(),
      },
    });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function unmarkPaid(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    await prisma.payment.deleteMany({
      where: { billId: bill.id, dueDate: new Date(String(formData.get("dueDate") ?? "")) },
    });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/** Updates a bill's payee, encrypted account access and service metadata. */
export async function updateBillPayeeDetails(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const billId = String(formData.get("billId") ?? "").trim();
  const parsed = billPayeeDetailsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const {
    accountNumber,
    clearAccountNumber,
    paymentsCanadaCcin,
    category: categoryRaw,
    ...details
  } = parsed.data;
  const category = resolveBillTaxonomy(categoryRaw).id;

  try {
    const bill = await ownedBill(userId, billId);
    const verifiedBiller = await resolveVerifiedBiller(details.billerKind, paymentsCanadaCcin);
    const accountData = clearAccountNumber
      ? { accountNumber: null, accountNumberEncrypted: null, accountNumberLast4: null }
      : accountNumber
        ? (() => {
            const protectedAccount = protectBillAccountNumber(accountNumber, userId, bill.id);
            return {
              accountNumber: null,
              accountNumberEncrypted: protectedAccount.encrypted,
              accountNumberLast4: protectedAccount.lastFour,
            };
          })()
        : {};
    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        name: details.name,
        category,
        payee: verifiedBiller?.payee ?? details.payee ?? null,
        accountNumberLabel: details.accountNumberLabel ?? null,
        loginIdentifier: details.loginIdentifier ?? null,
        credentialLocation: details.credentialLocation ?? null,
        serviceUrl: details.serviceUrl ?? null,
        loginUrl: details.loginUrl ?? null,
        billingUrl: details.billingUrl ?? null,
        cancellationUrl: details.cancellationUrl ?? null,
        billerKind: verifiedBiller?.billerKind ?? details.billerKind,
        notes: details.notes ?? null,
        ...accountData,
        paymentsCanadaCcin: verifiedBiller?.paymentsCanadaCcin ?? null,
        billerVerifiedAt: verifiedBiller?.billerVerifiedAt ?? null,
        billerVerificationEnv: verifiedBiller?.billerVerificationEnv ?? null,
      },
    });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
    revalidatePath("/");
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export type RevealBillAccountNumberResult =
  | { ok: true; accountNumber: string }
  | { ok: false; error: string };

export async function revealStoredBillAccountNumber(billId: string): Promise<RevealBillAccountNumberResult> {
  const userId = await requireUserId();
  try {
    const bill = await prisma.bill.findFirst({
      where: { id: billId, userId },
      select: {
        id: true,
        accountNumber: true,
        accountNumberEncrypted: true,
      },
    });
    if (!bill) return { ok: false, error: "Bill not found." };

    if (bill.accountNumberEncrypted) {
      return {
        ok: true,
        accountNumber: revealBillAccountNumber(bill.accountNumberEncrypted, userId, bill.id),
      };
    }

    // Lazy migration for values created before encrypted bill accounts shipped.
    // The plaintext is never returned until this authenticated, bill-owned action.
    if (bill.accountNumber) {
      const protectedAccount = protectBillAccountNumber(bill.accountNumber, userId, bill.id);
      await prisma.bill.update({
        where: { id: bill.id },
        data: {
          accountNumber: null,
          accountNumberEncrypted: protectedAccount.encrypted,
          accountNumberLast4: protectedAccount.lastFour,
        },
      });
      return { ok: true, accountNumber: bill.accountNumber };
    }
    return { ok: false, error: "No account number is stored for this bill." };
  } catch {
    return { ok: false, error: "The account number could not be revealed." };
  }
}
