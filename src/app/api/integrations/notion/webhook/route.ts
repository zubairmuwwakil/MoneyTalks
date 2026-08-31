import { Prisma } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { isAuthorizedPersonalDataRequest } from "@/lib/personal-data/inventory/auth";
import { PERSONAL_DATA_OWNER_KEY } from "@/lib/personal-data/inventory/config";
import { handleNotionInventoryWebhookEntity } from "@/lib/personal-data/inventory/sync";
import { verifyNotionWebhookSignature } from "@/lib/personal-data/inventory/signature";
import { decryptSecret, encryptSecret } from "@/lib/security/secretCrypto";

export const runtime = "nodejs";
export const maxDuration = 60;

type VerificationPayload = {
  verification_token: string;
};

type WebhookEventPayload = {
  id: string;
  timestamp?: string;
  workspace_id?: string;
  subscription_id?: string;
  integration_id?: string;
  type: string;
  attempt_number?: number;
  entity?: {
    id?: string;
    type?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVerificationPayload(value: unknown): value is VerificationPayload {
  return isRecord(value) && typeof value.verification_token === "string";
}

function isWebhookEventPayload(value: unknown): value is WebhookEventPayload {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string"
  );
}

function tokenContext() {
  return {
    userId: PERSONAL_DATA_OWNER_KEY,
    field: "notionWebhookVerificationToken" as const,
    entityRef: "notion-webhook",
  };
}

function parseTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasWebhookUrlKey(req: NextRequest): boolean {
  const configured = process.env["PERSONAL_DATA_NOTION_WEBHOOK_KEY"]?.trim();
  const supplied = req.nextUrl.searchParams.get("key")?.trim();
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured, "utf8");
  const actual = Buffer.from(supplied, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedPersonalDataRequest(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const subscription = await prisma.personalNotionSubscription.findUnique({
    where: { ownerKey: PERSONAL_DATA_OWNER_KEY },
    select: { verificationTokenEncrypted: true, subscriptionId: true },
  });
  if (!subscription) {
    return NextResponse.json({ ok: false, error: "No verification token received yet" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    verification_token: decryptSecret(subscription.verificationTokenEncrypted, tokenContext()),
    subscriptionId: subscription.subscriptionId,
  });
}

export async function POST(req: NextRequest) {
  if (!hasWebhookUrlKey(req)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const rawBody = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (isVerificationPayload(payload)) {
    await prisma.personalNotionSubscription.upsert({
      where: { ownerKey: PERSONAL_DATA_OWNER_KEY },
      create: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        verificationTokenEncrypted: encryptSecret(payload.verification_token, tokenContext()),
      },
      update: {
        verificationTokenEncrypted: encryptSecret(payload.verification_token, tokenContext()),
      },
    });

    // Never log or echo the token. An authenticated GET on this route can
    // retrieve it for the one-time paste into Notion's verification dialog.
    return NextResponse.json({ ok: true });
  }

  if (!isWebhookEventPayload(payload)) {
    return NextResponse.json({ ok: false, error: "Unsupported webhook payload" }, { status: 400 });
  }

  const subscription = await prisma.personalNotionSubscription.findUnique({
    where: { ownerKey: PERSONAL_DATA_OWNER_KEY },
  });
  if (!subscription) {
    return NextResponse.json(
      { ok: false, error: "Notion webhook subscription has not been verified" },
      { status: 503 },
    );
  }

  const verificationToken = decryptSecret(
    subscription.verificationTokenEncrypted,
    tokenContext(),
  );
  if (!verifyNotionWebhookSignature(
    rawBody,
    req.headers.get("x-notion-signature"),
    verificationToken,
  )) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  const existing = await prisma.personalNotionWebhookReceipt.findUnique({
    where: { id: payload.id },
    select: { processedAt: true },
  });
  if (existing?.processedAt) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const entityId = payload.entity?.id ?? null;
  const entityType = payload.entity?.type ?? null;
  await prisma.$transaction([
    prisma.personalNotionSubscription.update({
      where: { ownerKey: PERSONAL_DATA_OWNER_KEY },
      data: {
        workspaceId: payload.workspace_id ?? subscription.workspaceId,
        integrationId: payload.integration_id ?? subscription.integrationId,
        subscriptionId: payload.subscription_id ?? subscription.subscriptionId,
      },
    }),
    prisma.personalNotionWebhookReceipt.upsert({
      where: { id: payload.id },
      create: {
        id: payload.id,
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        eventType: payload.type,
        entityId,
        entityType,
        attemptNumber: payload.attempt_number ?? 1,
        notionTimestamp: parseTimestamp(payload.timestamp),
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      update: {
        eventType: payload.type,
        entityId,
        entityType,
        attemptNumber: payload.attempt_number ?? 1,
        notionTimestamp: parseTimestamp(payload.timestamp),
        payload: payload as unknown as Prisma.InputJsonValue,
        lastError: null,
      },
    }),
  ]);

  try {
    let result: unknown = { kind: "ignored", reason: "non-page event" };
    if (entityType === "page" && entityId) {
      result = await handleNotionInventoryWebhookEntity({
        eventType: payload.type,
        pageId: entityId,
      });
    }

    await prisma.personalNotionWebhookReceipt.update({
      where: { id: payload.id },
      data: { processedAt: new Date(), lastError: null },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.personalNotionWebhookReceipt.update({
      where: { id: payload.id },
      data: { lastError: message.slice(0, 2_000) },
    });
    // A non-2xx response asks Notion to retry. Synchronization itself is
    // idempotent because every canonical record is keyed by stable ID.
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
