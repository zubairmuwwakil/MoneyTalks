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

function recordId(formData: FormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${field}`);
  }
  return value;
}

async function ownedAccount(userId: string, accountId: string) {
  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true, currency: true },
  });
  if (!account) throw new Error("Account not found");
  return account;
}

export async function createAccount(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = accountInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  try {
    await prisma.financialAccount.create({ data: { ...parsed.data, userId } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteAccount(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const id = recordId(formData, "id");
    await ownedAccount(userId, id);
    await prisma.financialAccount.delete({ where: { id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function updateAccount(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = accountInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);

  let accountId: string;
  try {
    accountId = recordId(formData, "accountId");
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true, currency: true },
    });
    if (!account) throw new Error("Account not found");
    const { currency, ...editableData } = parsed.data;
    if (account.currency !== currency) {
      throw new Error("Currency cannot be changed after account creation");
    }

    await prisma.financialAccount.update({
      where: { id: account.id },
      data: editableData,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
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
  const parsed = transactionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  let accountId: string;
  try {
    accountId = recordId(formData, "accountId");
    const account = await ownedAccount(userId, accountId);
    await prisma.transaction.create({
      data: {
        ...parsed.data,
        accountId,
        currency: account.currency,
        date: new Date(parsed.data.date),
      },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function updateTransaction(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = transactionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);

  let accountId: string;
  try {
    const id = recordId(formData, "transactionId");
    const transaction = await prisma.transaction.findFirst({
      where: { id, account: { userId } },
      select: { id: true, accountId: true },
    });
    if (!transaction) throw new Error("Transaction not found");
    accountId = transaction.accountId;
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        ...parsed.data,
        date: new Date(parsed.data.date),
      },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteTransaction(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  let accountId: string;
  try {
    const id = recordId(formData, "transactionId");
    const transaction = await prisma.transaction.findFirst({
      where: { id, account: { userId } },
      select: { id: true, accountId: true },
    });
    if (!transaction) throw new Error("Transaction not found");
    accountId = transaction.accountId;
    await prisma.transaction.delete({ where: { id: transaction.id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/investments");
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

export async function deleteHolding(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  let accountId: string;
  try {
    const id = recordId(formData, "holdingId");
    const holding = await prisma.holding.findFirst({
      where: { id, account: { userId } },
      select: { id: true, accountId: true },
    });
    if (!holding) throw new Error("Holding not found");
    accountId = holding.accountId;
    await prisma.holding.delete({ where: { id: holding.id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  return { ok: true };
}

export async function deleteSnapshot(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  let accountId: string;
  try {
    const id = recordId(formData, "snapshotId");
    const snapshot = await prisma.balanceSnapshot.findFirst({
      where: { id, account: { userId } },
      select: { id: true, accountId: true },
    });
    if (!snapshot) throw new Error("Snapshot not found");
    accountId = snapshot.accountId;
    await prisma.balanceSnapshot.delete({ where: { id: snapshot.id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/investments/${accountId}`);
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}

export async function addFxRate(formData: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = fxRateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const { base, quote, rate, asOf } = parsed.data;
  try {
    await prisma.fxRate.upsert({
      where: { userId_base_quote_asOf: { userId, base, quote, asOf: new Date(asOf) } },
      update: { rate },
      create: { userId, base, quote, rate, asOf: new Date(asOf) },
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/investments");
  revalidatePath("/");
  return { ok: true };
}
