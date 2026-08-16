"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { parseDollarsToMinor } from "@/engine/money";
import { amountOn, type ScheduleEntry } from "@/engine/recurrence";
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
