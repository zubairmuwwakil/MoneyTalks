import { PersonalInventoryEventType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { applyInventoryMutation } from "./mutations";

const at = new Date("2026-08-31T12:00:00.000Z");

describe("applyInventoryMutation", () => {
  it("opens one unopened unit without changing total on hand", () => {
    const result = applyInventoryMutation(
      { backupUnits: 1, inUse: false, openedAt: null },
      { type: PersonalInventoryEventType.OPENED, occurredAt: at },
    );

    expect(result).toEqual({
      next: { backupUnits: 0, inUse: true, openedAt: at },
      quantityDelta: 0,
    });
  });

  it("finishes the open unit and reduces on-hand by one", () => {
    const result = applyInventoryMutation(
      { backupUnits: 2, inUse: true, openedAt: at },
      { type: PersonalInventoryEventType.FINISHED, occurredAt: at },
    );

    expect(result).toEqual({
      next: { backupUnits: 2, inUse: false, openedAt: null },
      quantityDelta: -1,
    });
  });

  it("adds purchases to unopened backups", () => {
    const result = applyInventoryMutation(
      { backupUnits: 1, inUse: true, openedAt: at },
      { type: PersonalInventoryEventType.PURCHASED, quantity: 2, occurredAt: at },
    );

    expect(result.next.backupUnits).toBe(3);
    expect(result.quantityDelta).toBe(2);
  });

  it("rejects a second open unit for the same SKU", () => {
    expect(() =>
      applyInventoryMutation(
        { backupUnits: 2, inUse: true, openedAt: at },
        { type: PersonalInventoryEventType.OPENED, occurredAt: at },
      ),
    ).toThrow("already has an open unit");
  });

  it("supports inventory corrections without inventing a purchase", () => {
    const result = applyInventoryMutation(
      { backupUnits: 4, inUse: true, openedAt: at },
      {
        type: PersonalInventoryEventType.ADJUSTMENT,
        backupUnits: 2,
        inUse: false,
        occurredAt: at,
      },
    );

    expect(result.next).toEqual({ backupUnits: 2, inUse: false, openedAt: null });
    expect(result.quantityDelta).toBe(-3);
  });
});
