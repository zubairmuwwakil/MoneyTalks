import {
  applyCatalogueValuationDefaults,
  Scorer,
  type Catalogue,
  type OwnerState,
} from "@/engine/cards-twin";
import type { BillRouteWalletCard } from "@/engine/billRouteScorer";
import { programDefaults } from "@/lib/contracts/cardCatalogue";

export interface StoredWalletCard {
  id: string;
  nickname: string;
  contractCardId: string | null;
}

/**
 * Resolves the user's wallet into the small input consumed by the bill-route
 * engine. The displayed name comes from the user's saved card when one exists;
 * reward rates come from the card catalogue plus the user's live owner state.
 */
export function buildBillRouteWallet(
  catalogue: Catalogue,
  ownerState: OwnerState | null,
  storedCards: StoredWalletCard[],
  asOfISODate: string,
): BillRouteWalletCard[] {
  if (!ownerState) return [];

  const stateWithDefaults = applyCatalogueValuationDefaults(ownerState, programDefaults);
  const storedByContractId = new Map(
    storedCards.flatMap((card) => card.contractCardId ? [[card.contractCardId, card] as const] : []),
  );

  return ownerState.ownedCardIds.flatMap((contractCardId) => {
    const product = catalogue.cards.find((card) => card.cardId === contractCardId);
    if (!product) return [];

    const score = Scorer.score(
      product,
      {
        amountCad: 100,
        currency: "CAD",
        category: "recurring",
        mcc: 6300,
        recurringIndicator: true,
        channel: "online",
      },
      stateWithDefaults,
      asOfISODate,
    );
    if (score.excluded) return [];

    const stored = storedByContractId.get(contractCardId);
    return [{
      walletCardId: stored?.id ?? null,
      contractCardId,
      programId: product.program.programId,
      displayName: stored?.nickname ?? product.officialName,
      recurringRewardRate: score.netValueCad / 100,
    }];
  });
}
