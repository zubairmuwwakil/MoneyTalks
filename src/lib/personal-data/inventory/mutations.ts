import { PersonalInventoryEventType } from "@prisma/client";

export type InventoryMutation = {
  type: PersonalInventoryEventType;
  quantity?: number;
  backupUnits?: number;
  inUse?: boolean;
  occurredAt: Date;
};

export type ProductState = {
  backupUnits: number;
  inUse: boolean;
  openedAt: Date | null;
};

export function applyInventoryMutation(
  state: ProductState,
  mutation: InventoryMutation,
): { next: ProductState; quantityDelta: number } {
  const beforeOnHand = Math.max(0, state.backupUnits) + (state.inUse ? 1 : 0);
  const quantity = mutation.quantity ?? 1;

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("quantity must be a positive integer");
  }

  let next: ProductState;

  switch (mutation.type) {
    case PersonalInventoryEventType.PURCHASED:
      next = {
        ...state,
        backupUnits: state.backupUnits + quantity,
      };
      break;

    case PersonalInventoryEventType.OPENED:
      if (state.inUse) throw new Error("product already has an open unit");
      if (state.backupUnits < 1) throw new Error("cannot open a product with no unopened unit");
      next = {
        backupUnits: state.backupUnits - 1,
        inUse: true,
        openedAt: mutation.occurredAt,
      };
      break;

    case PersonalInventoryEventType.FINISHED:
      if (!state.inUse) throw new Error("product has no open unit to finish");
      next = {
        backupUnits: state.backupUnits,
        inUse: false,
        openedAt: null,
      };
      break;

    case PersonalInventoryEventType.RETURNED:
    case PersonalInventoryEventType.DISCARDED:
      if (state.backupUnits < quantity) {
        throw new Error("cannot remove more unopened units than are available");
      }
      next = {
        ...state,
        backupUnits: state.backupUnits - quantity,
      };
      break;

    case PersonalInventoryEventType.ADJUSTMENT: {
      if (mutation.backupUnits === undefined && mutation.inUse === undefined) {
        throw new Error("adjustment requires backupUnits or inUse");
      }
      const backupUnits = mutation.backupUnits ?? state.backupUnits;
      if (!Number.isInteger(backupUnits) || backupUnits < 0) {
        throw new Error("backupUnits must be a non-negative integer");
      }
      const inUse = mutation.inUse ?? state.inUse;
      next = {
        backupUnits,
        inUse,
        openedAt: inUse ? state.openedAt ?? mutation.occurredAt : null,
      };
      break;
    }
  }

  const afterOnHand = Math.max(0, next.backupUnits) + (next.inUse ? 1 : 0);
  return { next, quantityDelta: afterOnHand - beforeOnHand };
}
