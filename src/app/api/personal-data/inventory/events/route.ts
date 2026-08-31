import {
  PersonalInventoryEventSource,
  PersonalInventoryEventType,
} from "@prisma/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedPersonalDataRequest } from "@/lib/personal-data/inventory/auth";
import { recordInventoryEvent } from "@/lib/personal-data/inventory/domain";

export const runtime = "nodejs";

const inputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  productStableId: z.string().trim().min(1).max(300),
  type: z.enum(["PURCHASED", "OPENED", "FINISHED", "ADJUSTMENT", "RETURNED", "DISCARDED"]),
  quantity: z.number().int().positive().max(100).optional(),
  backupUnits: z.number().int().nonnegative().max(1_000).optional(),
  inUse: z.boolean().optional(),
  occurredAt: z.string().datetime().optional(),
  source: z.enum(["AI", "API", "MANUAL"]).default("AI"),
  notes: z.string().trim().max(2_000).optional(),
});

const EVENT_TYPES: Record<z.infer<typeof inputSchema>["type"], PersonalInventoryEventType> = {
  PURCHASED: PersonalInventoryEventType.PURCHASED,
  OPENED: PersonalInventoryEventType.OPENED,
  FINISHED: PersonalInventoryEventType.FINISHED,
  ADJUSTMENT: PersonalInventoryEventType.ADJUSTMENT,
  RETURNED: PersonalInventoryEventType.RETURNED,
  DISCARDED: PersonalInventoryEventType.DISCARDED,
};

const EVENT_SOURCES: Record<z.infer<typeof inputSchema>["source"], PersonalInventoryEventSource> = {
  AI: PersonalInventoryEventSource.AI,
  API: PersonalInventoryEventSource.API,
  MANUAL: PersonalInventoryEventSource.MANUAL,
};

export async function POST(req: NextRequest) {
  if (!isAuthorizedPersonalDataRequest(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid inventory event", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();

  try {
    const result = await recordInventoryEvent({
      idempotencyKey: parsed.data.idempotencyKey,
      productStableId: parsed.data.productStableId,
      type: EVENT_TYPES[parsed.data.type],
      quantity: parsed.data.quantity,
      backupUnits: parsed.data.backupUnits,
      inUse: parsed.data.inUse,
      occurredAt,
      source: EVENT_SOURCES[parsed.data.source],
      notes: parsed.data.notes,
    });

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      eventId: result.event.id,
      product: result.product
        ? {
            stableId: result.product.stableId,
            backupUnits: result.product.backupUnits,
            inUse: result.product.inUse,
            openedAt: result.product.openedAt,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message.startsWith("unknown product") ? 404 :
      message.includes("inactive") || message.includes("cannot") || message.includes("already") ? 409 :
      400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
