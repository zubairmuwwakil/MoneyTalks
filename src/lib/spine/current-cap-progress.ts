import * as fs from "node:fs";
import * as path from "node:path";

type CapPeriod = "calendarMonth" | "calendarYear" | "accountYear";

type CardCap = {
  capId: string;
  period: CapPeriod;
};

type Catalogue = {
  cards: Array<{ cardId: string; caps: CardCap[] }>;
};

type OwnerState = {
  cardStates?: Record<string, { capProgress?: Record<string, number>; scotiaAccountYearAnchorMonth?: number }>;
};

export type CurrentCap = {
  usedMinor: number;
  periodKey: string;
};

function loadCatalogue(): Catalogue {
  const cataloguePath = path.resolve(process.cwd(), "contracts/card-catalogue.json");
  return JSON.parse(fs.readFileSync(cataloguePath, "utf8")) as Catalogue;
}

export function periodKey(period: CapPeriod, asOf: Date, anchorMonth?: number): string {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth() + 1;
  switch (period) {
  case "calendarMonth":
    return `${year}-${String(month).padStart(2, "0")}`;
  case "calendarYear":
    return String(year);
  case "accountYear": {
    // The account year is named for its starting month. A missing anchor is unresolved,
    // so retain an explicit unknown key rather than inventing a calendar-year reset.
    if (!anchorMonth || anchorMonth < 1 || anchorMonth > 12) return "unknown";
    const startYear = month >= anchorMonth ? year : year - 1;
    return `${startYear}-${String(anchorMonth).padStart(2, "0")}`;
  }
  }
}

/**
 * Until 3d's ledger is live, OwnerState's seeded cap progress is the read model.
 * Progress is stored in currency units in the card contract and exposed as minor units.
 */
export function currentCapProgress(stateData: unknown, asOf = new Date(), catalogue = loadCatalogue()): Record<string, CurrentCap> {
  const state = stateData as OwnerState;
  const caps: Record<string, CurrentCap> = {};

  for (const [cardId, cardState] of Object.entries(state.cardStates ?? {})) {
    const card = catalogue.cards.find((candidate) => candidate.cardId === cardId);
    if (!card || !cardState.capProgress) continue;

    for (const cap of card.caps) {
      const used = cardState.capProgress[cap.capId];
      if (typeof used !== "number" || !Number.isFinite(used)) continue;
      caps[cap.capId] = {
        usedMinor: Math.round(used * 100),
        periodKey: periodKey(cap.period, asOf, cardState.scotiaAccountYearAnchorMonth),
      };
    }
  }

  return caps;
}
