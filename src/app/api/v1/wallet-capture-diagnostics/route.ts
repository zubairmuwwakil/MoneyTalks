import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { deleteExpiredWalletDiagnostics, WALLET_DIAGNOSTIC_RETENTION_MS } from "@/lib/domain/wallet/diagnostics";

const timelineEntry = z.object({
  at: z.string().datetime({ offset: true }),
  stage: z.string().min(1).max(80),
  detail: z.string().max(160).nullable().optional(),
}).strict();

const reportSchema = z.object({
  reportID: z.string().uuid(),
  preparedAt: z.string().datetime({ offset: true }),
  eventID: z.string().min(1).max(80),
  serverEventID: z.string().min(1).max(160).nullable().optional(),
  deliveryState: z.string().max(40),
  amountDecodeStatus: z.string().max(40),
  missingFields: z.array(z.string().max(80)).max(20),
  attemptCount: z.number().int().nonnegative().max(10000),
  safeError: z.string().max(160).nullable().optional(),
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  appVersion: z.string().max(40).nullable().optional(),
  buildNumber: z.string().max(40).nullable().optional(),
  osVersion: z.string().max(80).nullable().optional(),
  captureVersion: z.number().int().nullable().optional(),
  locationOutcome: z.string().max(80).nullable().optional(),
  locationAccuracyCategory: z.enum(["precise", "nearby", "coarse"]).nullable().optional(),
  timeline: z.array(timelineEntry).max(100),
  includedTransactionDetails: z.boolean(),
  transactionDetails: z.record(z.string().max(40), z.string().max(500).nullable()).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.includedTransactionDetails && value.transactionDetails != null) {
    ctx.addIssue({ code: "custom", path: ["transactionDetails"], message: "details require explicit inclusion" });
  }
});

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });
  await deleteExpiredWalletDiagnostics();
  const raw = await req.json().catch(() => null);
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid diagnostic report" }, { status: 400 });
  const report = parsed.data;
  const event = report.serverEventID
    ? await prisma.walletEvent.findFirst({ where: { userId, eventId: report.serverEventID }, select: { id: true } })
    : null;
  const expiresAt = new Date(Date.now() + WALLET_DIAGNOSTIC_RETENTION_MS);
  const created = await prisma.walletCaptureDiagnostic.upsert({
    where: { clientReportId: report.reportID },
    create: { userId, walletEventId: event?.id ?? null, clientReportId: report.reportID,
      includedTransactionDetails: report.includedTransactionDetails,
      snapshot: report as unknown as Prisma.InputJsonValue, expiresAt },
    update: {},
    select: { id: true, expiresAt: true, userId: true },
  });
  if (created.userId !== userId) return new NextResponse("conflict", { status: 409 });
  return NextResponse.json({ id: created.id, expiresAt: created.expiresAt });
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });
  await deleteExpiredWalletDiagnostics();
  const reports = await prisma.walletCaptureDiagnostic.findMany({ where: { userId },
    select: { id: true, submittedAt: true, expiresAt: true, includedTransactionDetails: true },
    orderBy: { submittedAt: "desc" } });
  return NextResponse.json({ reports });
}
