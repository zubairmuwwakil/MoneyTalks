import "server-only";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export const PERSONAL_DATA_OWNER_KEY = env("PERSONAL_DATA_OWNER_KEY") || "primary";

export type NotionInventoryDataSources = {
  shoppingNeeds: string;
  products: string;
  inventoryEvents: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function notionInventoryConfig(): {
  token: string;
  dataSources: NotionInventoryDataSources;
} {
  return {
    token: requiredEnv("NOTION_API_KEY"),
    dataSources: {
      shoppingNeeds: requiredEnv("NOTION_PERSONAL_SHOPPING_NEEDS_DATA_SOURCE_ID"),
      products: requiredEnv("NOTION_PERSONAL_PRODUCTS_DATA_SOURCE_ID"),
      inventoryEvents: requiredEnv("NOTION_PERSONAL_INVENTORY_EVENTS_DATA_SOURCE_ID"),
    },
  };
}
