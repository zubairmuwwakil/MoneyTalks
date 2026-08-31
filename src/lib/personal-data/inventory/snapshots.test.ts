import { describe, expect, it } from "vitest";

import { deriveNeedSnapshot } from "./snapshots";

describe("deriveNeedSnapshot", () => {
  it("marks the last physical unit Buy Now and restores one open plus two backups", () => {
    expect(
      deriveNeedSnapshot({
        active: true,
        backupTarget: 2,
        reorderPoint: null,
        products: [{ backupUnits: 1, inUse: false }],
      }),
    ).toEqual({
      currentBackups: 1,
      inUseCount: 0,
      onHand: 1,
      reorderPoint: 1,
      urgency: "BUY_NOW",
      buyQty: 2,
    });
  });

  it("marks zero units critical", () => {
    expect(
      deriveNeedSnapshot({
        active: true,
        backupTarget: 2,
        reorderPoint: null,
        products: [{ backupUnits: 0, inUse: false }],
      }).urgency,
    ).toBe("CRITICAL");
  });

  it("uses Restock when safe on hand but unopened reserve is below target", () => {
    expect(
      deriveNeedSnapshot({
        active: true,
        backupTarget: 2,
        reorderPoint: 1,
        products: [{ backupUnits: 1, inUse: true }],
      }).urgency,
    ).toBe("RESTOCK");
  });

  it("never asks to buy for inactive needs", () => {
    const snapshot = deriveNeedSnapshot({
      active: false,
      backupTarget: 2,
      reorderPoint: 1,
      products: [],
    });
    expect(snapshot.urgency).toBe("INACTIVE");
    expect(snapshot.buyQty).toBe(0);
  });
});
