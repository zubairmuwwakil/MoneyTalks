"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import type { Catalogue, OwnerState } from "@/engine/cards-twin";
import { billOccurrences, type BillDef } from "@/engine/billforecast";
import type { FxRateInput } from "@/engine/fx";
import { parseDollarsToMinor, type Currency } from "@/engine/money";
import { amountOn, type Cadence, type ScheduleEntry } from "@/engine/recurrence";
import { billSpendCategoryOptions, recommendCardForBill } from "@/lib/domain/bills/cardForBill";
import { ensureOwnerStateRecord } from "@/lib/domain/ownerState";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { billFormInput, scheduleEntryInput } from "@/lib/validation/bills";

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

export async function createBill(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = billFormInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const { cadenceJson, scheduleJson, ...core } = parsed.data;

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

  await prisma.bill.create({
    data: { ...core, userId, cadence: asJson(cadenceJson), schedule: asJson(scheduleJson) },
  });
  revalidatePath("/bills");
  revalidatePath("/");
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
      { category: bill.category, currency: bill.currency, variable: bill.variable },
      next ? { amountMinor: next.amountMinor } : null,
      fxRates,
      today,
      { override: bill.spendCategory ?? undefined },
    );
    if (rec.status !== "recommended") {
      return { ok: false, error: "No recommendation is available for this bill yet." };
    }

    const card = await prisma.creditCard.findFirst({
      where: { userId, contractCardId: rec.winner.cardId },
      select: { id: true },
    });
    if (!card) return { ok: false, error: "Could not find the recommended card in your wallet." };

    await prisma.bill.update({ where: { id: bill.id }, data: { paymentCardId: card.id } });
    revalidatePath(`/bills/${bill.id}`);
    revalidatePath("/bills");
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

export async function addScheduleEntry(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = scheduleEntryInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    const bill = await ownedBill(userId, String(formData.get("billId") ?? ""));
    const schedule = [...(bill.schedule as unknown as ScheduleEntry[]), parsed.data];
    await prisma.bill.update({ where: { id: bill.id }, data: { schedule: asJson(schedule) } });
    revalidatePath(`/bills/${bill.id}`);
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
