import * as fs from "node:fs";
import * as path from "node:path";
import { capPeriodKey } from "@/lib/spine/cap-usage";

type CapPeriod = "calendarMonth" | "calendarYear" | "accountYear";

type CardCap = {
  capId: string;
  period: CapPeriod;
  anchor?: string;
};

type Catalogue = {
  cards: Array<{ cardId: string; caps: CardCap[] }>;
};

type OwnerState = {
  cardStates?: Record<string, {
    capProgress?: Record<string, number>;
    scotiaAccountYearAnchorMonth?: number;
    rogersAccountAnniversaryMonth?: number;
  }>;
};

export type CurrentCap = {
  usedMinor: number;
  periodKey: string;
};

export type CapLedgerRow = {
  cardId: string;
  capId: string;
  periodKey: string;
  usedMinor: number;
};

function loadCatalogue(): Catalogue {
  const cataloguePath = path.resolve(process.cwd(), "contracts/card-catalogue.json");
  return JSON.parse(fs.readFileSync(cataloguePath, "utf8")) as Catalogue;
}

export function periodKey(period: CapPeriod, asOf: Date, anchorMonth?: number): string {
  // Kept for callers/tests that predate the declared cap.anchor field.
  return capPeriodKey({ period, anchor: period === "accountYear" ? "ownerState.scotiaAccountYearAnchorMonth" : undefined }, { scotiaAccountYearAnchorMonth: anchorMonth }, asOf) ?? "unknown";
}

/**
 * OwnerState's seeded progress is the migration baseline. The spine route
 * overlays current-period CapUsageLedger rows with real observed use.
 */
export function currentCapProgress(stateData: unknown, asOf = new Date(), catalogue = loadCatalogue(), ledgerRows: CapLedgerRow[] = []): Record<string, CurrentCap> {
  const state = stateData as OwnerState;
  const caps: Record<string, CurrentCap> = {};
  const ledger = new Map(ledgerRows.map((row) => [`${row.cardId}:${row.capId}:${row.periodKey}`, row]));

  for (const [cardId, cardState] of Object.entries(state.cardStates ?? {})) {
    const card = catalogue.cards.find((candidate) => candidate.cardId === cardId);
    if (!card) continue;

    for (const cap of card.caps) {
      const currentPeriodKey = capPeriodKey(cap, cardState, asOf) ?? "unknown";
      const observed = ledger.get(`${cardId}:${cap.capId}:${currentPeriodKey}`);
      if (observed) {
        caps[cap.capId] = { usedMinor: observed.usedMinor, periodKey: observed.periodKey };
        continue;
      }

      const used = cardState.capProgress?.[cap.capId];
      if (typeof used !== "number" || !Number.isFinite(used)) continue;
      caps[cap.capId] = {
        usedMinor: Math.round(used * 100),
        periodKey: currentPeriodKey,
      };
    }
  }

  return caps;
}
