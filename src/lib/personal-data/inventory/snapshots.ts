export type InventoryUrgency = "CRITICAL" | "BUY_NOW" | "RESTOCK" | "STOCKED" | "INACTIVE";

export type InventoryProductState = {
  backupUnits: number;
  inUse: boolean;
};

export function deriveNeedSnapshot(input: {
  active: boolean;
  backupTarget: number;
  reorderPoint: number | null;
  products: InventoryProductState[];
}) {
  const currentBackups = input.products.reduce((sum, product) => sum + Math.max(0, product.backupUnits), 0);
  const inUseCount = input.products.reduce((sum, product) => sum + (product.inUse ? 1 : 0), 0);
  const onHand = currentBackups + inUseCount;
  const reorderPoint = input.reorderPoint ?? 1;

  let urgency: InventoryUrgency;
  if (!input.active) urgency = "INACTIVE";
  else if (onHand <= 0) urgency = "CRITICAL";
  else if (onHand <= reorderPoint) urgency = "BUY_NOW";
  else if (currentBackups < input.backupTarget) urgency = "RESTOCK";
  else urgency = "STOCKED";

  return {
    currentBackups,
    inUseCount,
    onHand,
    reorderPoint,
    urgency,
    buyQty: input.active ? Math.max(0, input.backupTarget + 1 - onHand) : 0,
  };
}
