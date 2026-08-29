import { describe, expect, it } from "vitest";
import type { Catalogue } from "@/engine/cards-twin";
import { cardCatalogue } from "@/lib/contracts/cardCatalogue";
import { defaultOwnerState } from "@/lib/domain/ownerState";
import { buildBillRouteWallet } from "./billRouteWallet";

const catalogue = cardCatalogue as unknown as Catalogue;

describe("buildBillRouteWallet", () => {
  it("uses the saved wallet name and contract-derived recurring reward rate", () => {
    const ownerState = defaultOwnerState(["scotia-momentum-vi-plus"]);
    const wallet = buildBillRouteWallet(
      catalogue,
      ownerState,
      [{ id: "db-card-1", nickname: "My red Scotia", contractCardId: "scotia-momentum-vi-plus" }],
      "2026-08-28",
    );

    expect(wallet).toEqual([
      expect.objectContaining({
        walletCardId: "db-card-1",
        contractCardId: "scotia-momentum-vi-plus",
        programId: "cashback",
        displayName: "My red Scotia",
        recurringRewardRate: 0.04,
      }),
    ]);
  });

  it("keeps an owner-state-only card routable without inventing a database wallet id", () => {
    const ownerState = defaultOwnerState(["triangle-we"]);
    const wallet = buildBillRouteWallet(catalogue, ownerState, [], "2026-08-28");

    expect(wallet).toEqual([
      expect.objectContaining({
        walletCardId: null,
        contractCardId: "triangle-we",
        displayName: "Triangle World Elite Mastercard",
      }),
    ]);
  });
});
