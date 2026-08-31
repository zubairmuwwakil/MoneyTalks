import "server-only";

import {
  PersonalInventoryEventSource,
  PersonalInventoryEventType,
  PersonalInventoryOutboxStatus,
  PersonalInventoryOutboxTopic,
  PersonalNotionEntityType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { PERSONAL_DATA_OWNER_KEY, notionInventoryConfig } from "./config";
import {
  createNotionDataSourcePage,
  notionCheckbox,
  notionDate,
  notionNumber,
  notionRelation,
  notionRichText,
  notionSelect,
  notionTitle,
  updateNotionPageProperties,
} from "./notion";

const STALE_PROCESSING_MS = 10 * 60 * 1_000;

function eventTypeLabel(type: PersonalInventoryEventType): string {
  switch (type) {
    case PersonalInventoryEventType.PURCHASED:
      return "Purchased";
    case PersonalInventoryEventType.OPENED:
      return "Opened";
    case PersonalInventoryEventType.FINISHED:
      return "Finished";
    case PersonalInventoryEventType.ADJUSTMENT:
      return "Adjustment";
    case PersonalInventoryEventType.RETURNED:
      return "Returned";
    case PersonalInventoryEventType.DISCARDED:
      return "Discarded";
  }
}

function eventSourceLabel(source: PersonalInventoryEventSource): string {
  switch (source) {
    case PersonalInventoryEventSource.MANUAL:
      return "Manual";
    case PersonalInventoryEventSource.BUTTON:
      return "Button";
    case PersonalInventoryEventSource.AI:
      return "AI";
    case PersonalInventoryEventSource.IMPORT:
      return "Import";
    case PersonalInventoryEventSource.API:
      return "API";
    case PersonalInventoryEventSource.NOTION:
      return "Notion";
  }
}

async function mappingPageId(
  entityType: PersonalNotionEntityType,
  stableId: string,
): Promise<string | null> {
  const mapping = await prisma.personalNotionEntityMap.findUnique({
    where: {
      ownerKey_entityType_stableId: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        entityType,
        stableId,
      },
    },
    select: { pageId: true, deletedAt: true },
  });
  return mapping && !mapping.deletedAt ? mapping.pageId : null;
}

async function syncProductToNotion(productId: string) {
  const product = await prisma.personalInventoryProduct.findUnique({
    where: { id: productId },
  });
  if (!product || product.ownerKey !== PERSONAL_DATA_OWNER_KEY) {
    throw new Error(`outbox product not found: ${productId}`);
  }

  const pageId = await mappingPageId(PersonalNotionEntityType.PRODUCT, product.stableId);
  if (!pageId) throw new Error(`Notion mapping missing for product ${product.stableId}`);

  await updateNotionPageProperties(pageId, {
    "Backup Units": notionNumber(product.backupUnits),
    "In Use?": notionCheckbox(product.inUse),
    "Opened Date": notionDate(product.openedAt),
  });
}

async function createEventInNotion(eventId: string) {
  const event = await prisma.personalInventoryEvent.findUnique({
    where: { id: eventId },
    include: { product: true, need: true },
  });
  if (!event || event.ownerKey !== PERSONAL_DATA_OWNER_KEY) {
    throw new Error(`outbox event not found: ${eventId}`);
  }

  const existingMapping = await prisma.personalNotionEntityMap.findUnique({
    where: {
      ownerKey_entityType_stableId: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        entityType: PersonalNotionEntityType.EVENT,
        stableId: event.externalKey,
      },
    },
  });
  if (existingMapping && !existingMapping.deletedAt) return;

  const productPageId = event.product
    ? await mappingPageId(PersonalNotionEntityType.PRODUCT, event.product.stableId)
    : null;
  const needPageId = event.need
    ? await mappingPageId(PersonalNotionEntityType.NEED, event.need.stableId)
    : null;

  const { dataSources } = notionInventoryConfig();
  const typeLabel = eventTypeLabel(event.type);
  const page = await createNotionDataSourcePage(dataSources.inventoryEvents, {
    Event: notionTitle(`${typeLabel} — ${event.product?.name ?? "Inventory"}`),
    "Event Date": notionDate(event.occurredAt),
    "Event Type": notionSelect(typeLabel),
    "Quantity Delta": notionNumber(event.quantityDelta),
    Product: notionRelation(productPageId ? [productPageId] : []),
    "Shopping Need": notionRelation(needPageId ? [needPageId] : []),
    Source: notionSelect(eventSourceLabel(event.source)),
    Notes: notionRichText(event.notes),
  });

  await prisma.personalNotionEntityMap.upsert({
    where: {
      ownerKey_entityType_stableId: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        entityType: PersonalNotionEntityType.EVENT,
        stableId: event.externalKey,
      },
    },
    create: {
      ownerKey: PERSONAL_DATA_OWNER_KEY,
      entityType: PersonalNotionEntityType.EVENT,
      stableId: event.externalKey,
      pageId: page.id,
      dataSourceId: dataSources.inventoryEvents,
      lastEditedAt: page.last_edited_time ? new Date(page.last_edited_time) : null,
      lastSyncedAt: new Date(),
    },
    update: {
      pageId: page.id,
      dataSourceId: dataSources.inventoryEvents,
      lastEditedAt: page.last_edited_time ? new Date(page.last_edited_time) : null,
      lastSyncedAt: new Date(),
      deletedAt: null,
    },
  });
}

async function dispatch(topic: PersonalInventoryOutboxTopic, aggregateId: string) {
  switch (topic) {
    case PersonalInventoryOutboxTopic.SYNC_PRODUCT_TO_NOTION:
      await syncProductToNotion(aggregateId);
      return;
    case PersonalInventoryOutboxTopic.CREATE_EVENT_IN_NOTION:
      await createEventInNotion(aggregateId);
      return;
  }
}

function retryAt(attempts: number): Date {
  const delayMs = Math.min(60 * 60 * 1_000, 30_000 * 2 ** Math.min(attempts, 7));
  return new Date(Date.now() + delayMs);
}

export async function processPersonalInventoryOutbox(limit = 25) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  await prisma.personalInventoryOutbox.updateMany({
    where: {
      ownerKey: PERSONAL_DATA_OWNER_KEY,
      status: PersonalInventoryOutboxStatus.PROCESSING,
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: PersonalInventoryOutboxStatus.FAILED,
      availableAt: new Date(),
      lastError: "Recovered stale PROCESSING item",
    },
  });

  const candidates = await prisma.personalInventoryOutbox.findMany({
    where: {
      ownerKey: PERSONAL_DATA_OWNER_KEY,
      status: {
        in: [
          PersonalInventoryOutboxStatus.PENDING,
          PersonalInventoryOutboxStatus.FAILED,
        ],
      },
      availableAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
  });

  let processed = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const item of candidates) {
    const claimed = await prisma.personalInventoryOutbox.updateMany({
      where: {
        id: item.id,
        status: {
          in: [
            PersonalInventoryOutboxStatus.PENDING,
            PersonalInventoryOutboxStatus.FAILED,
          ],
        },
      },
      data: { status: PersonalInventoryOutboxStatus.PROCESSING },
    });
    if (claimed.count !== 1) continue;

    try {
      await dispatch(item.topic, item.aggregateId);
      await prisma.personalInventoryOutbox.update({
        where: { id: item.id },
        data: {
          status: PersonalInventoryOutboxStatus.SENT,
          processedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.personalInventoryOutbox.update({
        where: { id: item.id },
        data: {
          status: PersonalInventoryOutboxStatus.FAILED,
          attempts: { increment: 1 },
          availableAt: retryAt(item.attempts + 1),
          lastError: message.slice(0, 2_000),
        },
      });
      failed += 1;
      errors.push({ id: item.id, error: message });
    }
  }

  return {
    candidates: candidates.length,
    processed,
    failed,
    errors,
  };
}
