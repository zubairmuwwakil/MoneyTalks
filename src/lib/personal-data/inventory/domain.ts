import "server-only";

import {
  PersonalInventoryEventSource,
  PersonalInventoryEventType,
  PersonalInventoryOutboxTopic,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { PERSONAL_DATA_OWNER_KEY } from "./config";
import { applyInventoryMutation } from "./mutations";
import { deriveNeedSnapshot } from "./snapshots";

export async function recordInventoryEvent(input: {
  idempotencyKey: string;
  productStableId: string;
  type: PersonalInventoryEventType;
  quantity?: number;
  backupUnits?: number;
  inUse?: boolean;
  occurredAt: Date;
  source: PersonalInventoryEventSource;
  notes?: string | null;
}) {
  const externalKey = `api:${input.idempotencyKey}`;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.personalInventoryEvent.findUnique({
      where: {
        ownerKey_externalKey: {
          ownerKey: PERSONAL_DATA_OWNER_KEY,
          externalKey,
        },
      },
      include: {
        product: true,
        need: true,
      },
    });

    if (existing) {
      return {
        duplicate: true as const,
        event: existing,
        product: existing.product,
        need: existing.need,
      };
    }

    const product = await tx.personalInventoryProduct.findUnique({
      where: {
        ownerKey_stableId: {
          ownerKey: PERSONAL_DATA_OWNER_KEY,
          stableId: input.productStableId,
        },
      },
      include: { need: true },
    });
    if (!product) throw new Error(`unknown product: ${input.productStableId}`);
    if (!product.active) throw new Error(`product is inactive: ${input.productStableId}`);

    const mutation = applyInventoryMutation(
      {
        backupUnits: product.backupUnits,
        inUse: product.inUse,
        openedAt: product.openedAt,
      },
      {
        type: input.type,
        quantity: input.quantity,
        backupUnits: input.backupUnits,
        inUse: input.inUse,
        occurredAt: input.occurredAt,
      },
    );

    const updatedProduct = await tx.personalInventoryProduct.update({
      where: { id: product.id },
      data: {
        backupUnits: mutation.next.backupUnits,
        inUse: mutation.next.inUse,
        openedAt: mutation.next.openedAt,
      },
    });

    const event = await tx.personalInventoryEvent.create({
      data: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        externalKey,
        type: input.type,
        quantityDelta: mutation.quantityDelta,
        occurredAt: input.occurredAt,
        source: input.source,
        notes: input.notes?.trim() || null,
        productId: product.id,
        needId: product.needId,
      },
    });

    await tx.personalInventoryOutbox.createMany({
      data: [
        {
          ownerKey: PERSONAL_DATA_OWNER_KEY,
          topic: PersonalInventoryOutboxTopic.SYNC_PRODUCT_TO_NOTION,
          dedupeKey: `sync-product:${event.id}`,
          aggregateId: product.id,
          payload: {},
        },
        {
          ownerKey: PERSONAL_DATA_OWNER_KEY,
          topic: PersonalInventoryOutboxTopic.CREATE_EVENT_IN_NOTION,
          dedupeKey: `create-event:${event.id}`,
          aggregateId: event.id,
          payload: {},
        },
      ],
      skipDuplicates: true,
    });

    return {
      duplicate: false as const,
      event,
      product: updatedProduct,
      need: product.need,
    };
  });
}

export async function listInventoryNeeds() {
  const needs = await prisma.personalInventoryNeed.findMany({
    where: { ownerKey: PERSONAL_DATA_OWNER_KEY },
    include: {
      products: {
        where: { active: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: [{ active: "desc" }, { aisle: "asc" }, { name: "asc" }],
  });

  const urgencyRank = {
    CRITICAL: 1,
    BUY_NOW: 2,
    RESTOCK: 3,
    STOCKED: 4,
    INACTIVE: 5,
  } as const;

  return needs
    .map((need) => {
      const snapshot = deriveNeedSnapshot({
        active: need.active,
        backupTarget: need.backupTarget,
        reorderPoint: need.reorderPoint,
        products: need.products,
      });
      return {
        stableId: need.stableId,
        name: need.name,
        aisle: need.aisle,
        active: need.active,
        backupTarget: need.backupTarget,
        reorderPoint: need.reorderPoint,
        defaultRetailer: need.defaultRetailer,
        ...snapshot,
        products: need.products.map((product) => ({
          stableId: product.stableId,
          name: product.name,
          brand: product.brand,
          backupUnits: product.backupUnits,
          inUse: product.inUse,
          openedAt: product.openedAt,
        })),
      };
    })
    .sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || a.name.localeCompare(b.name));
}
