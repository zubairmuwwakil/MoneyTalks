import "server-only";

import {
  PersonalInventoryEventSource,
  PersonalInventoryEventType,
  PersonalNotionEntityType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { PERSONAL_DATA_OWNER_KEY, notionInventoryConfig } from "./config";
import {
  NotionApiError,
  type NotionPage,
  queryNotionDataSource,
  retrieveNotionPage,
} from "./notion";
import {
  notionPageDataSourceId,
  notionPageEditedAt,
  readCheckbox,
  readDate,
  readInteger,
  readRelationIds,
  readSelect,
  readText,
} from "./notion-properties";

function sameNotionId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replaceAll("-", "").replace(/^collection:\/\//, "") === b.replaceAll("-", "").replace(/^collection:\/\//, "");
}

async function upsertMapping(input: {
  entityType: PersonalNotionEntityType;
  stableId: string;
  page: NotionPage;
  dataSourceId: string;
}) {
  await prisma.personalNotionEntityMap.upsert({
    where: {
      ownerKey_entityType_stableId: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        entityType: input.entityType,
        stableId: input.stableId,
      },
    },
    create: {
      ownerKey: PERSONAL_DATA_OWNER_KEY,
      entityType: input.entityType,
      stableId: input.stableId,
      pageId: input.page.id,
      dataSourceId: input.dataSourceId,
      lastEditedAt: notionPageEditedAt(input.page),
      lastSyncedAt: new Date(),
      deletedAt: input.page.in_trash || input.page.archived ? new Date() : null,
    },
    update: {
      pageId: input.page.id,
      dataSourceId: input.dataSourceId,
      lastEditedAt: notionPageEditedAt(input.page),
      lastSyncedAt: new Date(),
      deletedAt: input.page.in_trash || input.page.archived ? new Date() : null,
    },
  });
}

async function mappedEntityId(pageId: string, entityType: PersonalNotionEntityType): Promise<string | null> {
  const mapping = await prisma.personalNotionEntityMap.findUnique({
    where: { pageId },
    select: { entityType: true, stableId: true },
  });
  if (!mapping || mapping.entityType !== entityType) return null;

  if (entityType === PersonalNotionEntityType.NEED) {
    return (
      await prisma.personalInventoryNeed.findUnique({
        where: {
          ownerKey_stableId: {
            ownerKey: PERSONAL_DATA_OWNER_KEY,
            stableId: mapping.stableId,
          },
        },
        select: { id: true },
      })
    )?.id ?? null;
  }

  if (entityType === PersonalNotionEntityType.PRODUCT) {
    return (
      await prisma.personalInventoryProduct.findUnique({
        where: {
          ownerKey_stableId: {
            ownerKey: PERSONAL_DATA_OWNER_KEY,
            stableId: mapping.stableId,
          },
        },
        select: { id: true },
      })
    )?.id ?? null;
  }

  return null;
}

async function syncNeedPage(page: NotionPage, dataSourceId: string) {
  const stableId = readText(page, "Need ID");
  if (!stableId) return { kind: "ignored" as const, reason: "missing Need ID" };

  const record = await prisma.personalInventoryNeed.upsert({
    where: {
      ownerKey_stableId: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        stableId,
      },
    },
    create: {
      ownerKey: PERSONAL_DATA_OWNER_KEY,
      stableId,
      name: readText(page, "Need") || stableId,
      aisle: readSelect(page, "Aisle"),
      active: readCheckbox(page, "Active?"),
      backupTarget: readInteger(page, "Backup Target") ?? 1,
      reorderPoint: readInteger(page, "Reorder Point"),
      defaultRetailer: readSelect(page, "Default Retailer"),
      notes: readText(page, "Notes") || null,
    },
    update: {
      name: readText(page, "Need") || stableId,
      aisle: readSelect(page, "Aisle"),
      active: readCheckbox(page, "Active?"),
      backupTarget: readInteger(page, "Backup Target") ?? 1,
      reorderPoint: readInteger(page, "Reorder Point"),
      defaultRetailer: readSelect(page, "Default Retailer"),
      notes: readText(page, "Notes") || null,
    },
  });

  await upsertMapping({
    entityType: PersonalNotionEntityType.NEED,
    stableId,
    page,
    dataSourceId,
  });

  return { kind: "need" as const, id: record.id, stableId };
}

async function syncProductPage(page: NotionPage, dataSourceId: string) {
  const stableId = readText(page, "Product ID");
  if (!stableId) return { kind: "ignored" as const, reason: "missing Product ID" };

  const needPageId = readRelationIds(page, "Shopping Need")[0];
  const needId = needPageId ? await mappedEntityId(needPageId, PersonalNotionEntityType.NEED) : null;

  const record = await prisma.personalInventoryProduct.upsert({
    where: {
      ownerKey_stableId: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        stableId,
      },
    },
    create: {
      ownerKey: PERSONAL_DATA_OWNER_KEY,
      stableId,
      name: readText(page, "Product") || stableId,
      brand: readSelect(page, "Brand"),
      careArea: readSelect(page, "Care Area"),
      active: readCheckbox(page, "Active?"),
      backupUnits: Math.max(0, readInteger(page, "Backup Units") ?? 0),
      inUse: readCheckbox(page, "In Use?"),
      openedAt: readDate(page, "Opened Date"),
      repurchase: readSelect(page, "Repurchase?"),
      needsIdentification: readCheckbox(page, "Needs Identification?"),
      notes: readText(page, "Notes") || null,
      needId,
    },
    update: {
      name: readText(page, "Product") || stableId,
      brand: readSelect(page, "Brand"),
      careArea: readSelect(page, "Care Area"),
      active: readCheckbox(page, "Active?"),
      backupUnits: Math.max(0, readInteger(page, "Backup Units") ?? 0),
      inUse: readCheckbox(page, "In Use?"),
      openedAt: readDate(page, "Opened Date"),
      repurchase: readSelect(page, "Repurchase?"),
      needsIdentification: readCheckbox(page, "Needs Identification?"),
      notes: readText(page, "Notes") || null,
      needId,
    },
  });

  await upsertMapping({
    entityType: PersonalNotionEntityType.PRODUCT,
    stableId,
    page,
    dataSourceId,
  });

  return { kind: "product" as const, id: record.id, stableId };
}

function parseEventType(value: string | null): PersonalInventoryEventType | null {
  const normalized = value?.trim().toUpperCase().replaceAll(" ", "_");
  switch (normalized) {
    case "PURCHASED":
      return PersonalInventoryEventType.PURCHASED;
    case "OPENED":
      return PersonalInventoryEventType.OPENED;
    case "FINISHED":
      return PersonalInventoryEventType.FINISHED;
    case "ADJUSTMENT":
      return PersonalInventoryEventType.ADJUSTMENT;
    case "RETURNED":
      return PersonalInventoryEventType.RETURNED;
    case "DISCARDED":
      return PersonalInventoryEventType.DISCARDED;
    default:
      return null;
  }
}

function parseEventSource(value: string | null): PersonalInventoryEventSource {
  switch (value?.trim().toUpperCase()) {
    case "MANUAL":
      return PersonalInventoryEventSource.MANUAL;
    case "BUTTON":
      return PersonalInventoryEventSource.BUTTON;
    case "AI":
      return PersonalInventoryEventSource.AI;
    case "IMPORT":
      return PersonalInventoryEventSource.IMPORT;
    case "API":
      return PersonalInventoryEventSource.API;
    default:
      return PersonalInventoryEventSource.NOTION;
  }
}

async function syncEventPage(page: NotionPage, dataSourceId: string) {
  const type = parseEventType(readSelect(page, "Event Type"));
  const occurredAt = readDate(page, "Event Date");
  if (!type || !occurredAt) {
    return { kind: "ignored" as const, reason: "event missing type or date" };
  }

  const existingMap = await prisma.personalNotionEntityMap.findUnique({
    where: { pageId: page.id },
    select: { entityType: true, stableId: true },
  });

  const productPageId = readRelationIds(page, "Product")[0];
  const needPageId = readRelationIds(page, "Shopping Need")[0];
  const productId = productPageId
    ? await mappedEntityId(productPageId, PersonalNotionEntityType.PRODUCT)
    : null;
  const needId = needPageId
    ? await mappedEntityId(needPageId, PersonalNotionEntityType.NEED)
    : null;

  const externalKey =
    existingMap?.entityType === PersonalNotionEntityType.EVENT
      ? existingMap.stableId
      : `notion:${page.id}`;

  const record = await prisma.personalInventoryEvent.upsert({
    where: {
      ownerKey_externalKey: {
        ownerKey: PERSONAL_DATA_OWNER_KEY,
        externalKey,
      },
    },
    create: {
      ownerKey: PERSONAL_DATA_OWNER_KEY,
      externalKey,
      type,
      quantityDelta: readInteger(page, "Quantity Delta") ?? 0,
      occurredAt,
      source: parseEventSource(readSelect(page, "Source")),
      notes: readText(page, "Notes") || null,
      productId,
      needId,
    },
    update: {
      type,
      quantityDelta: readInteger(page, "Quantity Delta") ?? 0,
      occurredAt,
      source: parseEventSource(readSelect(page, "Source")),
      notes: readText(page, "Notes") || null,
      productId,
      needId,
    },
  });

  await upsertMapping({
    entityType: PersonalNotionEntityType.EVENT,
    stableId: existingMap?.entityType === PersonalNotionEntityType.EVENT ? existingMap.stableId : record.externalKey,
    page,
    dataSourceId,
  });

  return { kind: "event" as const, id: record.id };
}

export async function syncNotionInventoryPage(page: NotionPage) {
  const dataSourceId = notionPageDataSourceId(page);
  if (!dataSourceId) return { kind: "ignored" as const, reason: "not a data-source page" };

  const { dataSources } = notionInventoryConfig();
  if (sameNotionId(dataSourceId, dataSources.shoppingNeeds)) return syncNeedPage(page, dataSourceId);
  if (sameNotionId(dataSourceId, dataSources.products)) return syncProductPage(page, dataSourceId);
  if (sameNotionId(dataSourceId, dataSources.inventoryEvents)) return syncEventPage(page, dataSourceId);

  return { kind: "ignored" as const, reason: "unmanaged data source" };
}

export async function syncNotionInventoryPageById(pageId: string) {
  const page = await retrieveNotionPage(pageId);
  return syncNotionInventoryPage(page);
}

export async function markNotionInventoryPageDeleted(pageId: string) {
  const mapping = await prisma.personalNotionEntityMap.findUnique({
    where: { pageId },
  });
  if (!mapping || mapping.ownerKey !== PERSONAL_DATA_OWNER_KEY) {
    return { kind: "ignored" as const, reason: "unmapped deleted page" };
  }

  await prisma.personalNotionEntityMap.update({
    where: { pageId },
    data: { deletedAt: new Date(), lastSyncedAt: new Date() },
  });

  if (mapping.entityType === PersonalNotionEntityType.NEED) {
    await prisma.personalInventoryNeed.updateMany({
      where: { ownerKey: PERSONAL_DATA_OWNER_KEY, stableId: mapping.stableId },
      data: { active: false },
    });
  } else if (mapping.entityType === PersonalNotionEntityType.PRODUCT) {
    await prisma.personalInventoryProduct.updateMany({
      where: { ownerKey: PERSONAL_DATA_OWNER_KEY, stableId: mapping.stableId },
      data: { active: false },
    });
  }

  return { kind: "deleted" as const, entityType: mapping.entityType, stableId: mapping.stableId };
}

export async function handleNotionInventoryWebhookEntity(input: {
  eventType: string;
  pageId: string;
}) {
  if (input.eventType === "page.deleted") return markNotionInventoryPageDeleted(input.pageId);

  try {
    return await syncNotionInventoryPageById(input.pageId);
  } catch (error) {
    if (error instanceof NotionApiError && error.status === 404) {
      return markNotionInventoryPageDeleted(input.pageId);
    }
    throw error;
  }
}

export async function reconcileNotionInventory() {
  const { dataSources } = notionInventoryConfig();
  const [needPages, productPages, eventPages] = await Promise.all([
    queryNotionDataSource(dataSources.shoppingNeeds),
    queryNotionDataSource(dataSources.products),
    queryNotionDataSource(dataSources.inventoryEvents),
  ]);

  const counts = { needs: 0, products: 0, events: 0, ignored: 0 };

  for (const page of needPages) {
    const result = await syncNeedPage(page, dataSources.shoppingNeeds);
    result.kind === "need" ? counts.needs += 1 : counts.ignored += 1;
  }

  for (const page of productPages) {
    const result = await syncProductPage(page, dataSources.products);
    result.kind === "product" ? counts.products += 1 : counts.ignored += 1;
  }

  for (const page of eventPages) {
    const result = await syncEventPage(page, dataSources.inventoryEvents);
    result.kind === "event" ? counts.events += 1 : counts.ignored += 1;
  }

  return counts;
}
