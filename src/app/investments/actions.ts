"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import {
  accountInput,
  fxRateInput,
  holdingInput,
  snapshotInput,
  transactionInput,
} from "@/lib/validation/investments";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Invalid input" };
}

async function ownedAccount(userId: string, accountId: string) {
  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) throw new Error("Account not found");
  return account;
}

export async function createAccount(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = accountInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  await prisma.financialAccount.create({ data: { ...parsed.data, userId } });
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteAccount(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  try {
    await ownedAccount(userId, id);
    await prisma.financialAccount.delete({ where: { id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function addHolding(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const parsed = holdingInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    await ownedAccount(userId, accountId);
    await prisma.holding.upsert({
      where: { accountId_symbol: { accountId, symbol: parsed.data.symbol } },
      update: { ...parsed.data, priceAsOf: new Date(parsed.data.priceAsOf) },
      create: { ...parsed.data, accountId, priceAsOf: new Date(parsed.data.priceAsOf) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  return { ok: true };
}

export async function addTransaction(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const parsed = transactionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    await ownedAccount(userId, accountId);
    await prisma.transaction.create({
      data: { ...parsed.data, accountId, date: new Date(parsed.data.date) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function addSnapshot(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const accountId = String(formData.get("accountId") ?? "");
  const parsed = snapshotInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId },
      select: { currency: true },
    });
    if (!account) throw new Error("Account not found");
    await prisma.balanceSnapshot.upsert({
      where: { accountId_asOf: { accountId, asOf: new Date(parsed.data.asOf) } },
      update: { balanceMinor: parsed.data.balanceMinor },
      create: {
        accountId,
        balanceMinor: parsed.data.balanceMinor,
        currency: account.currency,
        asOf: new Date(parsed.data.asOf),
      },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function addFxRate(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = fxRateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const { base, quote, rate, asOf } = parsed.data;
  await prisma.fxRate.upsert({
    where: { userId_base_quote_asOf: { userId, base, quote, asOf: new Date(asOf) } },
    update: { rate },
    create: { userId, base, quote, rate, asOf: new Date(asOf) },
  });
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}
